import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'

import { asyncHandler, AppError, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { Clarification } from '../models/Clarification'
import { utcDateBucket } from '../models/AiUsageCounter'
import { runTool } from '../modules/ai/toolRunner'
import { interpretCustomAnswer } from '../modules/ai/resolveClarificationAnswer'
import { isAiConfigured } from '../modules/ai/provider/geminiClient'
import { recordUsage } from '../modules/ai/quota'

export const meClarificationsRouter = Router()

// GET /me/clarifications — the OPEN held items powering the home banner +
// /clarify card stack. Newest first. Resolved/dropped never come back.
meClarificationsRouter.get(
  '/me/clarifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const docs = await Clarification.find({ userId: auth.sub, status: 'open' })
      .sort({ createdAt: -1 })
      .limit(50)
    res.status(200).json({ clarifications: docs.map((d) => d.toJSON()) })
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
//   { answer: { type: 'custom', text } }   → Mo interprets the text, then create.
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

    let createArgs: Record<string, unknown>
    let answerLabel: string
    let usedAi = false

    if (answer.type === 'option') {
      const opt = doc.options[answer.index]
      if (!opt) throw BadRequest('invalid_option', 'That answer is no longer available.')
      // toISOString() carries an explicit offset (Z), so normalizeLocalIso in
      // createTask returns the SAME instant — picking an option never shifts the date.
      const dueAt = (opt.dueAt ?? doc.draft.dueAt)?.toISOString()
      createArgs = {
        title: opt.title ?? doc.draft.title,
        domain: doc.draft.domain,
        priority: doc.draft.priority,
        notes: opt.notes ?? doc.draft.notes,
        tags: doc.draft.tags,
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
      createArgs = await interpretCustomAnswer({
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
      answerLabel = answer.text
      usedAi = true
    }

    // Create through the shared tool path (validates + normalizes the date).
    const out = await runTool({
      userId: auth.sub,
      name: 'createTask',
      args: createArgs,
      timezone,
    })
    const task = out.result.task as { id: string } | undefined

    doc.status = 'resolved'
    doc.answer = answerLabel
    doc.resolvedAt = new Date()
    if (task?.id) doc.createdTaskId = new Types.ObjectId(task.id)
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
