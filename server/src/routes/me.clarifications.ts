import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'

import { asyncHandler, AppError, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { Clarification, visibleOpen } from '../models/Clarification'
import { Task, notDeleted } from '../models/Task'
import { utcDateBucket } from '../models/AiUsageCounter'
import { runTool } from '../modules/ai/toolRunner'
import { interpretCustomAnswer } from '../modules/ai/resolveClarificationAnswer'
import { isAiConfigured } from '../modules/ai/provider/geminiClient'
import { recordUsage } from '../modules/ai/quota'

export const meClarificationsRouter = Router()

// How long a skipped item stays out of sight before it may be offered again.
const DEFER_MS = 7 * 24 * 60 * 60 * 1000
// One more than the page size, so the response can honestly say whether more
// exist rather than silently truncating at a round number.
const PAGE_SIZE = 50

// GET /me/clarifications — the OPEN held items powering the home banner +
// /clarify card stack. Newest first. Resolved/dropped never come back, and a
// deferred item stays hidden until its deferredUntil passes.
meClarificationsRouter.get(
  '/me/clarifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const filter = { userId: auth.sub, ...visibleOpen() }
    // Cursor is the createdAt of the last item seen (list is newest-first).
    const cursor = typeof req.query.before === 'string' ? new Date(req.query.before) : null
    const paged =
      cursor && !Number.isNaN(cursor.getTime())
        ? { ...filter, createdAt: { $lt: cursor } }
        : filter

    const docs = await Clarification.find(paged)
      .sort({ createdAt: -1 })
      .limit(PAGE_SIZE + 1)
    const hasMore = docs.length > PAGE_SIZE
    const page = hasMore ? docs.slice(0, PAGE_SIZE) : docs

    res.status(200).json({
      clarifications: page.map((d) => d.toJSON()),
      hasMore,
      nextCursor: hasMore ? (page[page.length - 1]?.createdAt?.toISOString() ?? null) : null,
    })
  }),
)

const ResolveBodySchema = z.object({
  answer: z.discriminatedUnion('type', [
    // Picked a pre-resolved suggestion → deterministic create (no AI).
    z.object({ type: z.literal('option'), index: z.number().int().min(0).max(3) }),
    // Typed their own → one bounded Gemini call interprets it into a task.
    z.object({ type: z.literal('custom'), text: z.string().trim().min(1).max(500) }),
  ]),
  // Caller's IANA timezone — anchors a typed date answer + normalizes the create.
  timezone: z.string().min(1).max(64).optional(),
})

// POST /me/clarifications/:id/resolve — answer a held item; creates the Task.
//   { answer: { type: 'option', index } }  → merge the option's patch, create.
//   { answer: { type: 'custom', text } }   → Kitto interprets the text, then create.
// Always routes the final args through toolRunner.createTask so the Task is
// identical to one the chat agent would have made (same validation + tz norm).
meClarificationsRouter.post(
  '/me/clarifications/:id/resolve',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('clarification_not_found', 'That question is no longer here.')
    }
    const doc = await Clarification.findOne({ _id: id, userId: auth.sub })
    if (!doc) throw NotFound('clarification_not_found', 'That question is no longer here.')

    // Idempotent: already answered/dropped (double-tap, stale client) → echo
    // current state instead of creating a duplicate task.
    if (doc.status !== 'open') {
      res.status(200).json({ clarification: doc.toJSON(), task: null })
      return
    }

    const parsed = ResolveBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_answer', 'Invalid answer payload.', parsed.error.flatten())
    }
    const { answer, timezone } = parsed.data

    // The task already exists — it was created when the question was raised.
    // If it has since been deleted the question is moot: close it out rather
    // than resurrecting work the user threw away.
    const existing = await Task.findOne({ _id: doc.taskId, userId: auth.sub, ...notDeleted() })
    if (!existing) {
      doc.status = 'dropped'
      doc.resolvedAt = new Date()
      await doc.save()
      res.status(200).json({ clarification: doc.toJSON(), task: null })
      return
    }

    let patch: Record<string, unknown>
    let answerLabel: string
    let usedAi = false

    if (answer.type === 'option') {
      const opt = doc.options[answer.index]
      if (!opt) throw BadRequest('invalid_option', 'That answer is no longer available.')
      // toISOString() carries an explicit offset (Z), so normalizeLocalIso in
      // updateTask returns the SAME instant — picking an option never shifts the date.
      const dueAt = (opt.dueAt ?? doc.draft.dueAt)?.toISOString()
      patch = {
        ...(opt.title ? { title: opt.title } : {}),
        ...(opt.notes ? { notes: opt.notes } : {}),
        ...(dueAt ? { dueAt } : {}),
      }
      answerLabel = opt.label
    } else {
      if (!isAiConfigured()) {
        throw new AppError(
          503,
          'ai_not_configured',
          'Typing your own answer needs AI configured. Pick one of the suggestions instead.',
        )
      }
      // Interprets into createTask-shaped args; keep only the fields that make
      // sense as an edit to a task that already exists.
      const interpreted = await interpretCustomAnswer({
        draft: {
          title: doc.draft.title,
          domain: doc.draft.domain,
          priority: doc.draft.priority,
          notes: doc.draft.notes,
          dueAt: doc.draft.dueAt?.toISOString(),
        },
        question: doc.question,
        customText: answer.text,
        timezone,
      })
      patch = {
        ...(interpreted.title ? { title: interpreted.title } : {}),
        ...(interpreted.domain ? { domain: interpreted.domain } : {}),
        ...(interpreted.priority ? { priority: interpreted.priority } : {}),
        ...(interpreted.notes ? { notes: interpreted.notes } : {}),
        ...(interpreted.dueAt ? { dueAt: interpreted.dueAt } : {}),
      }
      answerLabel = answer.text
      usedAi = true
    }

    // A confirmed date is the whole point of asking: a task whose reminder was
    // withheld on an uncertain high-stakes date becomes a real reminder now.
    const confirmsDate = typeof patch.dueAt === 'string'
    const out = await runTool({
      userId: auth.sub,
      name: 'updateTask',
      args: { taskId: String(doc.taskId), ...patch, ...(confirmsDate ? { kind: 'reminder' } : {}) },
      timezone,
    })

    doc.status = 'resolved'
    doc.answer = answerLabel
    doc.resolvedAt = new Date()
    await doc.save()

    // Count the (paid) custom interpretation against the chat quota — best
    // effort, NOT gated: resolving a held item completes work the user already
    // started, so we never refuse it with a 402.
    if (usedAi) {
      await recordUsage({ userId: auth.sub, kind: 'message', today: utcDateBucket() }).catch(() => {})
    }

    res.status(200).json({ clarification: doc.toJSON(), task: out.result.task })
  }),
)

// POST /me/clarifications/:id/defer — "not now". The card stack's Skip.
//
// Skip used to be purely local (it advanced an index and made no request), so
// the server never learned the user had already passed on the item and served
// it again identically next session. Honouring a dismissal is the whole point
// of the affordance.
meClarificationsRouter.post(
  '/me/clarifications/:id/defer',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('clarification_not_found', 'That question is no longer here.')
    }
    const doc = await Clarification.findOne({ _id: id, userId: auth.sub })
    if (!doc) throw NotFound('clarification_not_found', 'That question is no longer here.')

    if (doc.status === 'open') {
      doc.deferredUntil = new Date(Date.now() + DEFER_MS)
      await doc.save()
    }
    res.status(200).json({ clarification: doc.toJSON() })
  }),
)

// POST /me/clarifications/:id/drop — discard a held item without creating a task.
meClarificationsRouter.post(
  '/me/clarifications/:id/drop',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('clarification_not_found', 'That question is no longer here.')
    }
    const doc = await Clarification.findOne({ _id: id, userId: auth.sub })
    if (!doc) throw NotFound('clarification_not_found', 'That question is no longer here.')

    if (doc.status === 'open') {
      doc.status = 'dropped'
      doc.resolvedAt = new Date()
      await doc.save()
    }
    res.status(200).json({ clarification: doc.toJSON() })
  }),
)
