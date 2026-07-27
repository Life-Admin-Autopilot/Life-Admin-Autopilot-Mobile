import { Types } from 'mongoose'
import { z } from 'zod'
import { BadRequest, NotFound } from '../../lib/errors'
import { DOMAINS } from '../../models/User'
import { MAX_TAGS, Task, normalizeTag, notDeleted, type TaskDoc } from '../../models/Task'
import {
  BULK_OP_TTL_DAYS,
  TaskBulkOp,
  bulkOpExpiry,
  type BulkAction,
  type BulkOpEntry,
} from '../../models/TaskBulkOp'
import { TaskFilterSchema, buildTaskFilter, type TaskFilter } from './taskQuery'

// Multi-task mutation, with undo as a first-class outcome rather than a
// bolt-on. Every path here writes exactly one TaskBulkOp before touching a
// Task, so there is never a window where work has happened that can't be
// reversed.
//
// Deletion is ALWAYS soft. That is enforced here, in the only code path that
// can delete more than one task, rather than trusted to a prompt rule — the
// agent calls this same service, so it is structurally incapable of an
// irreversible bulk delete.

// Cap on one operation. Past this the user almost certainly means "everything",
// and a mistake at that size is not something an undo toast can console them
// about — the UI should make them narrow the range instead.
export const MAX_BULK_TARGETS = 500

const ObjectIdString = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v), { message: 'invalid_object_id' })

export const BulkTargetSchema = z
  .object({
    ids: z.array(ObjectIdString).min(1).max(MAX_BULK_TARGETS).optional(),
    filter: TaskFilterSchema.optional(),
  })
  .refine((v) => Boolean(v.ids) !== Boolean(v.filter), {
    message: 'provide exactly one of ids or filter',
  })

export const BulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete') }),
  z.object({ action: z.literal('complete') }),
  z.object({ action: z.literal('snooze'), until: z.string().datetime() }),
  z.object({ action: z.literal('setDomain'), domain: z.enum(DOMAINS) }),
  z.object({ action: z.literal('addTags'), tags: z.array(z.string().max(64)).min(1).max(MAX_TAGS) }),
])

export type BulkActionInput = z.infer<typeof BulkActionSchema>

export interface BulkTarget {
  ids?: string[]
  filter?: TaskFilter
}

// Resolve either an explicit id list or a filter into concrete tasks. Both
// paths are user-scoped and exclude already-trashed rows, so a filter can never
// reach beyond the caller's own live data.
export async function resolveTargets(
  userId: string,
  target: BulkTarget,
  now: Date = new Date(),
): Promise<TaskDoc[]> {
  if (target.ids) {
    return Task.find({ _id: { $in: target.ids }, userId, ...notDeleted() })
  }
  if (!target.filter) throw BadRequest('invalid_body', 'Provide ids or a filter.')
  return Task.find(buildTaskFilter(userId, target.filter, now)).limit(MAX_BULK_TARGETS + 1)
}

export interface BulkWarnings {
  // Tasks that came from a scanned document — deleting them orphans the review
  // trail back to that document, which the user deserves to be told about.
  fromDocuments: number
  // Tasks whose reminder has already fired. These represent commitments the
  // user was actively notified about, not silent backlog.
  remindersFired: number
  // True when the filter matched more than one operation may touch.
  truncated: boolean
}

export function summarizeWarnings(tasks: TaskDoc[]): BulkWarnings {
  return {
    fromDocuments: tasks.filter((t) => Boolean(t.sourceDocumentId)).length,
    remindersFired: tasks.filter((t) => t.reminders.some((r) => Boolean(r.firedAt))).length,
    truncated: tasks.length > MAX_BULK_TARGETS,
  }
}

// Build the before/after patch pair for one task under one action.
//
// `prior` uses the model's null convention: an explicit `null` means the field
// was absent and must be `$unset` on undo. Recording the field as simply
// missing would leave it stranded at its post-op value.
function patchFor(
  task: TaskDoc,
  input: BulkActionInput,
  now: Date,
): { prior: Record<string, unknown>; next: Record<string, unknown> } | null {
  switch (input.action) {
    case 'delete':
      return { prior: { deletedAt: null }, next: { deletedAt: now } }

    case 'complete':
      if (task.status === 'done') return null
      return {
        prior: { status: task.status, completedAt: task.completedAt ?? null },
        next: { status: 'done', completedAt: now },
      }

    case 'snooze':
      return {
        prior: {
          status: task.status,
          snoozedUntil: task.snoozedUntil ?? null,
        },
        next: { status: 'snoozed', snoozedUntil: new Date(input.until) },
      }

    case 'setDomain':
      if (task.domain === input.domain) return null
      return { prior: { domain: task.domain }, next: { domain: input.domain } }

    case 'addTags': {
      const additions = input.tags
        .map((t) => normalizeTag(t))
        .filter((t): t is string => Boolean(t))
      const merged = [...new Set([...task.tags, ...additions])].slice(0, MAX_TAGS)
      if (merged.length === task.tags.length && additions.every((t) => task.tags.includes(t))) {
        return null
      }
      return { prior: { tags: [...task.tags] }, next: { tags: merged } }
    }
  }
}

// Split a patch into the $set/$unset halves Mongo needs.
function toMongoOps(patch: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {}
  const unset: Record<string, 1> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) unset[key] = 1
    else set[key] = value
  }
  const ops: Record<string, unknown> = {}
  if (Object.keys(set).length > 0) ops.$set = set
  if (Object.keys(unset).length > 0) ops.$unset = unset
  return ops
}

export interface BulkResult {
  affected: number
  undoToken: string | null
  warnings: BulkWarnings
}

export async function applyBulk(
  userId: string,
  target: BulkTarget,
  input: BulkActionInput,
  opts: { label?: string; now?: Date } = {},
): Promise<BulkResult> {
  const now = opts.now ?? new Date()
  const tasks = await resolveTargets(userId, target, now)
  const warnings = summarizeWarnings(tasks)

  if (warnings.truncated) {
    throw BadRequest(
      'bulk_too_large',
      `That matches more than ${MAX_BULK_TARGETS} matters. Narrow the range and try again.`,
    )
  }

  const entries: BulkOpEntry[] = []
  for (const task of tasks) {
    const patch = patchFor(task, input, now)
    // A no-op (already done, already in that domain) is skipped rather than
    // recorded, so undo can't "restore" a change that never happened.
    if (!patch) continue
    entries.push({ taskId: task._id, prior: patch.prior, next: patch.next })
  }

  if (entries.length === 0) {
    return { affected: 0, undoToken: null, warnings }
  }

  // The op record is written FIRST. If the bulk write fails halfway, the record
  // still describes what was intended and undo restores whatever landed.
  const op = await TaskBulkOp.create({
    userId,
    kind: 'bulk',
    action: input.action as BulkAction,
    status: 'applied',
    entries,
    label: opts.label,
    appliedAt: now,
    expiresAt: bulkOpExpiry(now),
  })

  await Task.bulkWrite(
    entries.map((e) => ({
      updateOne: { filter: { _id: e.taskId, userId }, update: toMongoOps(e.next) },
    })),
  )

  return { affected: entries.length, undoToken: String(op._id), warnings }
}

export async function undoBulk(userId: string, token: string): Promise<{ restored: number }> {
  if (!Types.ObjectId.isValid(token)) {
    throw NotFound('undo_not_found', `That change is no longer undoable.`)
  }
  const op = await TaskBulkOp.findOne({ _id: token, userId })
  if (!op) {
    throw NotFound(
      'undo_not_found',
      `That change is no longer undoable — undo is available for ${BULK_OP_TTL_DAYS} days.`,
    )
  }

  // Idempotent: undoing twice is a no-op, not an error. A double-tap on the
  // toast must not surface a failure for work that is already reversed.
  if (op.status !== 'applied') return { restored: 0 }

  await Task.bulkWrite(
    op.entries.map((e) => ({
      updateOne: { filter: { _id: e.taskId, userId }, update: toMongoOps(e.prior) },
    })),
  )

  op.status = 'undone'
  op.undoneAt = new Date()
  await op.save()

  return { restored: op.entries.length }
}
