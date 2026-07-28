import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { AppError, asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { taskSearchLimiter, taskSummaryLimiter } from '../middleware/rateLimit'
import { isAiConfigured } from '../modules/ai/provider/geminiClient'
import { admitWithinQuota, releaseUsageSlot } from '../modules/ai/quota'
import { searchMatters } from '../modules/tasks/semanticSearch'
import { summarizeRange } from '../modules/tasks/summarize'
import { MAX_BACKLOG_BATCH, estimateBacklog } from '../modules/tasks/estimateBacklog'
import { DOMAINS } from '../models/User'
import {
  MAX_SUBTASK_TEXT,
  MAX_SUBTASKS,
  MAX_TAGS,
  Task,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  normalizeEstimate,
  normalizeTag,
  notDeleted,
} from '../models/Task'
import {
  BulkActionSchema,
  BulkTargetSchema,
  applyBulk,
  resolveTargets,
  summarizeWarnings,
  undoBulk,
} from '../modules/tasks/bulkService'
import { proposeCategorization } from '../modules/tasks/categorize/propose'
import { MAX_CATEGORIZE_TARGETS } from '../modules/tasks/categorize/prompt'
import {
  applyProposal,
  discardProposal,
  getPendingProposal,
} from '../modules/tasks/categorize/apply'
import { computeTaskCounts } from '../modules/tasks/taskCounts'
import {
  DEFAULT_TASK_SORT,
  TASK_SORTS,
  TaskFilterSchema,
  listTasks,
} from '../modules/tasks/taskQuery'

export const meTasksRouter = Router()

const ObjectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'invalid_object_id' })

const IsoDate = z
  .string()
  .datetime()
  .transform((v) => new Date(v))

// Accepts raw user-input tag strings, normalizes (lowercase-kebab) and
// drops empties/dupes. Caps at MAX_TAGS — extras are dropped silently.
const TagsInput = z
  .array(z.string().max(64))
  .max(MAX_TAGS * 2)
  .transform((arr) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of arr) {
      const tag = normalizeTag(raw)
      if (!tag) continue
      if (seen.has(tag)) continue
      seen.add(tag)
      out.push(tag)
      if (out.length >= MAX_TAGS) break
    }
    return out
  })

// A hand-set time window. Snapped onto the bucket ladder like any other
// estimate — the user picks from buckets in the UI, but the server does not
// take that on trust — and stamped `source: 'user'`, which is what makes it
// authoritative forever: every AI path is required to skip it from then on.
const EstimateInput = z
  .object({
    minMinutes: z.number().int().min(1).max(1440),
    maxMinutes: z.number().int().min(1).max(1440),
  })
  .strict()
  .transform((v) => normalizeEstimate(v, 'user'))

const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    domain: z.enum(DOMAINS),
    kind: z.enum(TASK_KINDS).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: TagsInput.optional(),
    dueAt: IsoDate.optional(),
    notes: z.string().max(2000).optional(),
    estimate: EstimateInput.optional(),
    sourceVoiceNoteId: ObjectIdString.optional(),
  })
  .strict()

const UpdateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    domain: z.enum(DOMAINS).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: TagsInput.optional(),
    dueAt: IsoDate.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    // null clears the estimate back to "unknown" — which is a real answer, and
    // a truer one than a number the user does not stand behind.
    estimate: EstimateInput.nullable().optional(),
    snoozedUntil: IsoDate.nullable().optional(),
  })
  .strict()

// Filters live in modules/tasks/taskQuery so the REST list, the chat agent's
// queryTasks tool, and the NL search compiler can never drift apart. This
// schema only adds the transport concerns on top: paging and sort.
//
// Still `.strict()` — an unknown param is a 400, never a silently-ignored
// filter that returns more than the user asked for.
const ListQuerySchema = TaskFilterSchema.extend({
  sort: z.enum(TASK_SORTS).default(DEFAULT_TASK_SORT),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).optional(),
}).strict()

meTasksRouter.get(
  '/me/tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = ListQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw BadRequest('invalid_query', 'Invalid task list query.', parsed.error.flatten())
    }
    const { sort, limit, cursor, ...filter } = parsed.data

    const { tasks, total, nextCursor } = await listTasks(auth.sub, filter, {
      sort,
      limit,
      cursor,
    })

    res.status(200).json({
      tasks: tasks.map((t) => t.toJSON()),
      total,
      nextCursor,
    })
  }),
)

// Bucket counts for the Matters header, filter badges and the dashboard hero.
// `tz` is the caller's IANA zone — day boundaries are meaningless without it.
const CountsQuerySchema = z.object({ tz: z.string().max(64).optional() }).strict()

meTasksRouter.get(
  '/me/tasks/counts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = CountsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw BadRequest('invalid_query', 'Invalid counts query.', parsed.error.flatten())
    }
    const counts = await computeTaskCounts(auth.sub, parsed.data.tz)
    res.status(200).json({ counts })
  }),
)

// Distinct tag list for autocomplete in the create/edit sheet. Returns
// all tags the user has ever used, sorted lexicographically. Cheap because
// it uses the {userId, tags} index.
meTasksRouter.get(
  '/me/tasks/tags',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const tags = (await Task.distinct('tags', {
      userId: auth.sub,
      ...notDeleted(),
    })) as string[]
    res.status(200).json({ tags: tags.sort() })
  }),
)

// ---- AI: natural-language search + range summary ----
//
// Both consume the same daily message quota as a chat turn — they are the same
// cost to serve, and a separate allowance would just be a way to spend more
// without noticing.

const SearchSchema = z
  .object({
    query: z.string().trim().min(1).max(400),
    timezone: z.string().max(64).optional(),
  })
  .strict()

// Search by description. Returns the matching matters themselves, ranked by
// relevance, plus a sentence saying what was found — not a filter to go and run.
meTasksRouter.post(
  '/me/tasks/search',
  requireAuth,
  taskSearchLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    // Validate before checking availability, so a malformed request always
    // reports what is actually wrong with it rather than masking as a 503.
    const parsed = SearchSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid search request.', parsed.error.flatten())
    }
    if (!isAiConfigured()) {
      throw new AppError(503, 'ai_not_configured', 'Search by description is unavailable.')
    }

    await admitWithinQuota({ userId: auth.sub, tier: 'free', kind: 'message' })

    let result
    try {
      result = await searchMatters({
        userId: auth.sub,
        query: parsed.data.query,
        timezone: parsed.data.timezone,
      })
    } catch (err: unknown) {
      // Refund the slot — the user got nothing for it.
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
      throw err
    }

    res.status(200).json({
      answer: result.answer,
      truncated: result.truncated,
      matches: result.matches.map((m) => ({ task: m.task.toJSON(), reason: m.reason })),
    })
  }),
)

const SummarizeSchema = z
  .object({
    from: IsoDate,
    to: IsoDate,
    timezone: z.string().max(64).optional(),
  })
  .strict()
  .refine((v) => v.to > v.from, { message: 'to must be after from' })

meTasksRouter.post(
  '/me/tasks/summarize',
  requireAuth,
  taskSummaryLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    if (!isAiConfigured()) {
      throw new AppError(503, 'ai_not_configured', 'Summaries are unavailable right now.')
    }

    const parsed = SummarizeSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid summary range.', parsed.error.flatten())
    }

    await admitWithinQuota({ userId: auth.sub, tier: 'free', kind: 'message' })

    let summary
    try {
      summary = await summarizeRange({
        userId: auth.sub,
        from: parsed.data.from,
        to: parsed.data.to,
        timezone: parsed.data.timezone,
      })
    } catch (err: unknown) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
      throw err
    }

    res.status(200).json({ summary })
  }),
)

// Backfill estimates for matters that predate the feature. One batched model
// call per request, capped — a client that wants the whole backlog covered
// calls again while `remaining` is above zero, rather than the server holding a
// request open across many rounds.
const EstimateBacklogSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_BACKLOG_BATCH).optional(),
  })
  .strict()

meTasksRouter.post(
  '/me/tasks/estimate-backlog',
  requireAuth,
  taskSummaryLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = EstimateBacklogSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid backfill request.', parsed.error.flatten())
    }
    if (!isAiConfigured()) {
      throw new AppError(503, 'ai_not_configured', 'Estimates are unavailable right now.')
    }

    await admitWithinQuota({ userId: auth.sub, tier: 'free', kind: 'message' })

    let result
    try {
      result = await estimateBacklog({ userId: auth.sub, limit: parsed.data.limit })
    } catch (err: unknown) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
      throw err
    }
    // estimateBacklog swallows model failures and reports zero rather than
    // throwing, so refund the slot when the user got nothing for it.
    if (result.estimated === 0) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
    }

    res.status(200).json(result)
  }),
)

// ---- Bulk operations ----
//
// Every route below writes exactly one TaskBulkOp, so the whole operation
// reverses with a single `POST /me/tasks/undo/:token`.

const BulkBodySchema = z.intersection(BulkTargetSchema, BulkActionSchema)

// Dry run. The confirm card needs the exact count and the ripple warnings
// BEFORE anything happens — a natural-language range must never be deleted
// from directly, only from a resolved, previewed set.
meTasksRouter.post(
  '/me/tasks/bulk/preview',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = BulkBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid bulk request.', parsed.error.flatten())
    }
    const tasks = await resolveTargets(auth.sub, parsed.data)
    res.status(200).json({
      count: tasks.length,
      warnings: summarizeWarnings(tasks),
      // Enough to scroll through and sanity-check what is about to change.
      sample: tasks.slice(0, 50).map((t) => t.toJSON()),
    })
  }),
)

meTasksRouter.post(
  '/me/tasks/bulk',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = BulkBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid bulk request.', parsed.error.flatten())
    }
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 240) : undefined
    const result = await applyBulk(auth.sub, parsed.data, parsed.data, { label })
    res.status(200).json(result)
  }),
)

meTasksRouter.post(
  '/me/tasks/undo/:token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const result = await undoBulk(auth.sub, String(req.params.token ?? ''))
    res.status(200).json(result)
  }),
)

// ---- AI categorize ----
//
// Unlike every other bulk route, proposing writes NOTHING to Task. The run is
// staged as a TaskBulkOp in `proposed`, reviewed, and only then committed —
// because a domain is required on every matter, so this always overwrites an
// answer that already exists rather than filling a blank.
//
// Applying goes through the same TaskBulkOp record, so `POST /me/tasks/undo/:token`
// reverses a categorize run with no special casing.

meTasksRouter.post(
  '/me/tasks/categorize',
  requireAuth,
  taskSummaryLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = BulkTargetSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid categorize request.', parsed.error.flatten())
    }
    if (!isAiConfigured()) {
      throw new AppError(503, 'ai_not_configured', 'Categorising is unavailable right now.')
    }

    // The unique partial index would reject the second insert anyway; answering
    // here means the client gets a resumable state instead of a duplicate-key
    // error it would have to decode.
    const open = await getPendingProposal(auth.sub)
    if (open) {
      throw new AppError(
        409,
        'categorize_already_open',
        'You already have suggestions waiting. Review those first.',
        { opId: open.opId },
      )
    }

    await admitWithinQuota({ userId: auth.sub, tier: 'free', kind: 'message' })

    let result
    try {
      result = await proposeCategorization({ userId: auth.sub, target: parsed.data })
    } catch (err: unknown) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
      throw err
    }
    // Nothing proposed means the filing was already right — a fine answer, but
    // not one worth charging for.
    if (result.changes.length === 0) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message' }).catch(() => {})
    }

    res.status(200).json(result)
  }),
)

meTasksRouter.get(
  '/me/tasks/categorize/pending',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    res.status(200).json({ proposal: await getPendingProposal(auth.sub) })
  }),
)

const ApplyProposalSchema = z
  .object({ taskIds: z.array(ObjectIdString).max(MAX_CATEGORIZE_TARGETS) })
  .strict()

meTasksRouter.post(
  '/me/tasks/categorize/:id/apply',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = ApplyProposalSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid apply request.', parsed.error.flatten())
    }
    const result = await applyProposal(auth.sub, String(req.params.id), parsed.data.taskIds)
    res.status(200).json(result)
  }),
)

meTasksRouter.post(
  '/me/tasks/categorize/:id/discard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    await discardProposal(auth.sub, String(req.params.id))
    res.status(204).end()
  }),
)

// ---- Trash ----

meTasksRouter.get(
  '/me/tasks/trash',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const tasks = await Task.find({ userId: auth.sub, deletedAt: { $exists: true } })
      .sort({ deletedAt: -1 })
      .limit(200)
    res.status(200).json({ tasks: tasks.map((t) => t.toJSON()) })
  }),
)

meTasksRouter.delete(
  '/me/tasks/trash',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    // The one genuinely irreversible operation in the app. It is reachable only
    // from an explicit "Empty trash" in the Trash view, never from a filter.
    const result = await Task.deleteMany({ userId: auth.sub, deletedAt: { $exists: true } })
    res.status(200).json({ purged: result.deletedCount ?? 0 })
  }),
)

meTasksRouter.post(
  '/me/tasks/:id/restore',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    const task = await Task.findOneAndUpdate(
      { _id: id, userId: auth.sub, deletedAt: { $exists: true } },
      { $unset: { deletedAt: 1 } },
      { new: true },
    )
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    res.status(200).json({ task: task.toJSON() })
  }),
)

meTasksRouter.get(
  '/me/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    const task = await Task.findOne({ _id: id, userId: auth.sub, ...notDeleted() })
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    res.status(200).json({ task: task.toJSON() })
  }),
)

meTasksRouter.post(
  '/me/tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = CreateTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid task payload.', parsed.error.flatten())
    }

    const task = await Task.create({
      userId: auth.sub,
      title: parsed.data.title,
      domain: parsed.data.domain,
      // Derive when unspecified: a dated manual task fires (reminder), a dateless
      // one is a passive list item. Mirrors the chat tool's derivation.
      kind: parsed.data.kind ?? (parsed.data.dueAt ? 'reminder' : 'list'),
      priority: parsed.data.priority ?? 'normal',
      tags: parsed.data.tags ?? [],
      dueAt: parsed.data.dueAt,
      notes: parsed.data.notes,
      estimate: parsed.data.estimate,
      sourceVoiceNoteId: parsed.data.sourceVoiceNoteId,
      status: 'open',
    })

    res.status(201).json({ task: task.toJSON() })
  }),
)

meTasksRouter.patch(
  '/me/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }

    const parsed = UpdateTaskSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid task update.', parsed.error.flatten())
    }

    const existing = await Task.findOne({ _id: id, userId: auth.sub, ...notDeleted() })
    if (!existing) throw NotFound('task_not_found', 'Task no longer exists.')

    const update: Record<string, unknown> = {}
    const unset: Record<string, 1> = {}

    for (const [key, value] of Object.entries(parsed.data)) {
      if (value === null) {
        unset[key] = 1
      } else if (value !== undefined) {
        update[key] = value
      }
    }

    // Track completion timestamp on status transition to `done`.
    const nextStatus = parsed.data.status
    if (nextStatus === 'done') {
      update.completedAt = new Date()
    } else if (nextStatus !== undefined) {
      unset.completedAt = 1
    }

    const ops: Record<string, unknown> = {}
    if (Object.keys(update).length > 0) ops.$set = update
    if (Object.keys(unset).length > 0) ops.$unset = unset

    // Count only pushes BACK. Pulling a task forward is the user taking it
    // seriously; shunting it later is the slip signal that drives "what's
    // slipping" and the reminder-fatigue nudge.
    const nextDue = parsed.data.dueAt
    if (nextDue instanceof Date && existing.dueAt && nextDue > existing.dueAt) {
      ops.$inc = { rescheduleCount: 1 }
    }

    const task = await Task.findOneAndUpdate(
      { _id: id, userId: auth.sub, ...notDeleted() },
      ops,
      { new: true },
    )
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    res.status(200).json({ task: task.toJSON() })
  }),
)

// ---- Subtasks ----

const AddSubtaskSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_SUBTASK_TEXT),
  })
  .strict()

const UpdateSubtaskSchema = z
  .object({
    text: z.string().trim().min(1).max(MAX_SUBTASK_TEXT).optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.text !== undefined || v.done !== undefined, {
    message: 'must include text or done',
  })

meTasksRouter.post(
  '/me/tasks/:id/subtasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }

    const parsed = AddSubtaskSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid subtask payload.', parsed.error.flatten())
    }

    const task = await Task.findOne({ _id: id, userId: auth.sub, ...notDeleted() })
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    if (task.subtasks.length >= MAX_SUBTASKS) {
      throw BadRequest(
        'subtask_limit',
        `This task already has ${MAX_SUBTASKS} subtasks — remove some before adding more.`,
      )
    }
    task.subtasks.push({ text: parsed.data.text, done: false })
    await task.save()
    res.status(201).json({ task: task.toJSON() })
  }),
)

meTasksRouter.patch(
  '/me/tasks/:id/subtasks/:subId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    const subId = String(req.params.subId ?? '')
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(subId)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }

    const parsed = UpdateSubtaskSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid subtask update.', parsed.error.flatten())
    }

    const task = await Task.findOne({ _id: id, userId: auth.sub, ...notDeleted() })
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    const sub = task.subtasks.find((s) => String(s._id) === subId)
    if (!sub) throw NotFound('subtask_not_found', 'Subtask no longer exists.')
    if (parsed.data.text !== undefined) sub.text = parsed.data.text
    if (parsed.data.done !== undefined) sub.done = parsed.data.done
    await task.save()
    res.status(200).json({ task: task.toJSON() })
  }),
)

meTasksRouter.delete(
  '/me/tasks/:id/subtasks/:subId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    const subId = String(req.params.subId ?? '')
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(subId)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    const task = await Task.findOne({ _id: id, userId: auth.sub, ...notDeleted() })
    if (!task) throw NotFound('task_not_found', 'Task no longer exists.')
    const before = task.subtasks.length
    task.subtasks = task.subtasks.filter((s) => String(s._id) !== subId)
    if (task.subtasks.length === before) {
      throw NotFound('subtask_not_found', 'Subtask no longer exists.')
    }
    await task.save()
    res.status(200).json({ task: task.toJSON() })
  }),
)

meTasksRouter.delete(
  '/me/tasks/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = String(req.params.id ?? '')
    if (!Types.ObjectId.isValid(id)) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    // Routed through the bulk service so a single swipe-delete produces the
    // same TaskBulkOp record — and therefore the same one-tap undo — as a
    // date-range wipe. One delete path, one undo path.
    const result = await applyBulk(auth.sub, { ids: [id] }, { action: 'delete' })
    if (result.affected === 0) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    res.status(200).json({ undoToken: result.undoToken })
  }),
)
