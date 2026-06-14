import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { DOMAINS } from '../models/User'
import {
  MAX_SUBTASK_TEXT,
  MAX_SUBTASKS,
  MAX_TAGS,
  Task,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  normalizeTag,
} from '../models/Task'

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

const CreateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    domain: z.enum(DOMAINS),
    kind: z.enum(TASK_KINDS).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: TagsInput.optional(),
    dueAt: IsoDate.optional(),
    notes: z.string().max(2000).optional(),
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
    snoozedUntil: IsoDate.nullable().optional(),
  })
  .strict()

const ListQuerySchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    domain: z.enum(DOMAINS).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tag: z.string().max(64).optional(),
    dueBefore: IsoDate.optional(),
    dueAfter: IsoDate.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()

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
    const { status, domain, priority, tag, dueBefore, dueAfter, limit } = parsed.data

    const filter: Record<string, unknown> = { userId: auth.sub }
    if (status) filter.status = status
    if (domain) filter.domain = domain
    if (priority) filter.priority = priority
    if (tag) {
      const normalized = normalizeTag(tag)
      if (normalized) filter.tags = normalized
    }
    if (dueBefore || dueAfter) {
      const dueAt: Record<string, Date> = {}
      if (dueBefore) dueAt.$lte = dueBefore
      if (dueAfter) dueAt.$gte = dueAfter
      filter.dueAt = dueAt
    }

    const tasks = await Task.find(filter)
      .sort({ dueAt: 1, createdAt: -1 })
      .limit(limit)

    res.status(200).json({ tasks: tasks.map((t) => t.toJSON()) })
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
    const tags = (await Task.distinct('tags', { userId: auth.sub })) as string[]
    res.status(200).json({ tags: tags.sort() })
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
    const task = await Task.findOne({ _id: id, userId: auth.sub })
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

    const task = await Task.findOneAndUpdate(
      { _id: id, userId: auth.sub },
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

    const task = await Task.findOne({ _id: id, userId: auth.sub })
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

    const task = await Task.findOne({ _id: id, userId: auth.sub })
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
    const task = await Task.findOne({ _id: id, userId: auth.sub })
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
    const result = await Task.deleteOne({ _id: id, userId: auth.sub })
    if (result.deletedCount === 0) {
      throw NotFound('task_not_found', 'Task no longer exists.')
    }
    res.status(204).end()
  }),
)
