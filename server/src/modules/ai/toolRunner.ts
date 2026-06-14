import { Types } from 'mongoose'
import { z } from 'zod'

import { AppError } from '../../lib/errors'
import { DOMAINS } from '../../models/User'
import {
  MAX_SUBTASK_TEXT,
  MAX_SUBTASKS,
  MAX_TAGS,
  Task,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  normalizeTag,
} from '../../models/Task'

// Tag input from the model is sanitized identically to the HTTP route.
const tagArrayInput = z
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
import { STRICT_DATETIME_RE, normalizeLocalIso } from './timeNormalize'
import { createClarification } from '../clarifications/createClarification'
import { setRulesReminders, setSnoozeReminder } from '../reminders/planReminders'

// Tool registry — six tools the agent can invoke. Args declared once as
// Zod and (separately, in stream-personal.ts) as Gemini functionDeclarations
// so the model never produces args we can't validate. Mirrors Wiscord's
// `tool-runner.ts`. Tools delegate to the existing Task model so the AI is
// just another caller — same authz path, same business rules.

export const TOOL_NAMES = [
  'createTask',
  'updateTask',
  'completeTask',
  'deleteTask',
  'deleteAllTasks',
  'snoozeTask',
  'queryTasks',
  'addSubtask',
  'toggleSubtask',
  'removeSubtask',
  'holdForClarification',
] as const
export type ToolName = (typeof TOOL_NAMES)[number]

const isoString = z.string().regex(STRICT_DATETIME_RE, 'must be ISO 8601 datetime')

export const createTaskArgs = z
  .object({
    title: z.string().trim().min(1).max(240),
    domain: z.enum(DOMAINS),
    // 'reminder' = will fire (needs a date); 'list' = passive list item.
    // Optional for back-compat: when omitted we derive it from dueAt so legacy
    // callers and tests keep working. The chat agent always sends it explicitly.
    kind: z.enum(TASK_KINDS).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tags: tagArrayInput.optional(),
    dueAt: isoString.optional(),
    notes: z.string().max(2000).optional(),
  })
  // Fill kind from the date signal when the caller didn't specify it.
  .transform((v) => ({ ...v, kind: v.kind ?? (v.dueAt ? 'reminder' : 'list') }))
  // The reminder invariant, enforced BEFORE persistence so the model receives a
  // clean, actionable error and can either add a date or hold the item instead
  // of silently filing a reminder that can never reach the user.
  .refine((v) => v.kind !== 'reminder' || Boolean(v.dueAt), {
    message:
      'A reminder must have a dueAt. Give it a date (default a sensible one for low-stakes items) or hold it for clarification instead.',
    path: ['dueAt'],
  })

export const updateTaskArgs = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1).max(240).optional(),
  domain: z.enum(DOMAINS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  // Full replace — send the desired final tag list, NOT a delta.
  tags: tagArrayInput.optional(),
  dueAt: isoString.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  // Empty string or null clears notes. Omit to leave unchanged.
  notes: z.string().max(2000).nullable().optional(),
})

export const completeTaskArgs = z.object({
  taskId: z.string().min(1),
})

export const deleteTaskArgs = z.object({
  taskId: z.string().min(1),
})

// Bulk delete — wipe many tasks in one confirmed operation. No taskId: an
// empty filter deletes EVERY task. Optional filters narrow the blast radius
// ("clear my finance tasks", "delete completed"). This is what the agent
// reaches for on "delete all my tasks" instead of firing N deleteTask calls.
export const deleteAllTasksArgs = z.object({
  domain: z.enum(DOMAINS).optional(),
  status: z.enum(TASK_STATUSES).optional(),
})

export const snoozeTaskArgs = z.object({
  taskId: z.string().min(1),
  until: isoString,
})

export const addSubtaskArgs = z.object({
  taskId: z.string().min(1),
  text: z.string().trim().min(1).max(MAX_SUBTASK_TEXT),
})

export const toggleSubtaskArgs = z.object({
  taskId: z.string().min(1),
  subtaskId: z.string().min(1),
  // Optional — when omitted, flips current state.
  done: z.boolean().optional(),
})

export const removeSubtaskArgs = z.object({
  taskId: z.string().min(1),
  subtaskId: z.string().min(1),
})

export const queryTasksArgs = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  domain: z.enum(DOMAINS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  tag: z.string().max(64).optional(),
  dueBefore: isoString.optional(),
  dueAfter: isoString.optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

// One pre-resolved suggested answer for a held item. `label` is the chip text;
// the optional patch fields (dueAt/title/notes) merge onto the draft when the
// user picks it, so picking creates the Task deterministically (no AI round).
const clarificationOptionArgs = z.object({
  label: z.string().trim().min(1).max(80),
  dueAt: isoString.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  notes: z.string().max(2000).optional(),
})

// Hold a genuinely-fuzzy item instead of creating it. Non-destructive: runs
// inline and persists a Clarification the home banner + /clarify flow resolve
// later. This is how Mo "asks" now — NOT free-text in the reply.
export const holdForClarificationArgs = z.object({
  // The provisional task Mo would create once the question is answered.
  title: z.string().trim().min(1).max(240),
  domain: z.enum(DOMAINS),
  priority: z.enum(TASK_PRIORITIES).optional(),
  tags: tagArrayInput.optional(),
  notes: z.string().max(2000).optional(),
  // Best-guess due date, if any — carried so a "skip for now" item still has it.
  dueAtGuess: isoString.optional(),
  // The specific question to ask ("Is it the 15th or the 18th?").
  question: z.string().trim().min(1).max(300),
  kind: z.enum(['date', 'detail', 'choice']),
  options: z.array(clarificationOptionArgs).max(4).optional(),
})

export type CreateTaskArgs = z.infer<typeof createTaskArgs>
export type UpdateTaskArgs = z.infer<typeof updateTaskArgs>
export type CompleteTaskArgs = z.infer<typeof completeTaskArgs>
export type DeleteTaskArgs = z.infer<typeof deleteTaskArgs>
export type DeleteAllTasksArgs = z.infer<typeof deleteAllTasksArgs>
export type SnoozeTaskArgs = z.infer<typeof snoozeTaskArgs>
export type QueryTasksArgs = z.infer<typeof queryTasksArgs>
export type AddSubtaskArgs = z.infer<typeof addSubtaskArgs>
export type ToggleSubtaskArgs = z.infer<typeof toggleSubtaskArgs>
export type RemoveSubtaskArgs = z.infer<typeof removeSubtaskArgs>
export type HoldForClarificationArgs = z.infer<typeof holdForClarificationArgs>

const PARSER_BY_NAME = {
  createTask: createTaskArgs,
  updateTask: updateTaskArgs,
  completeTask: completeTaskArgs,
  deleteTask: deleteTaskArgs,
  deleteAllTasks: deleteAllTasksArgs,
  snoozeTask: snoozeTaskArgs,
  queryTasks: queryTasksArgs,
  addSubtask: addSubtaskArgs,
  toggleSubtask: toggleSubtaskArgs,
  removeSubtask: removeSubtaskArgs,
  holdForClarification: holdForClarificationArgs,
} as const satisfies Record<ToolName, z.ZodTypeAny>

// Which tools still pause for a human Confirm/Decline. The agent is trusted to
// act directly on every per-item mutation (update / delete one / remove one
// subtask) — those run inline. The ONLY exception is the bulk wipe: deleting
// EVERY matter in one call is catastrophic and unrecoverable, so it alone keeps
// the guard. Everything else is "based on agent" — no confirmation step.
export function requiresConfirmation(name: ToolName): boolean {
  return name === 'deleteAllTasks'
}

export function validateToolArgs(name: ToolName, args: unknown): unknown {
  const parser = PARSER_BY_NAME[name]
  const result = parser.safeParse(args)
  if (!result.success) {
    throw new AppError(400, 'invalid_tool_args', JSON.stringify(result.error.flatten()))
  }
  return result.data
}

interface RunArgs {
  userId: string
  name: ToolName
  args: unknown
  timezone?: string
}

// Run a non-destructive tool immediately. Destructive tools throw —
// callers must route them through runConfirmedTool after the user
// confirms.
export async function runTool(
  args: RunArgs,
): Promise<{ result: Record<string, unknown> }> {
  if (requiresConfirmation(args.name)) {
    throw new AppError(
      400,
      'tool_requires_confirmation',
      `${args.name} requires user confirmation before executing`,
    )
  }
  const validated = validateToolArgs(args.name, args.args)
  return dispatch(args.userId, args.name, validated, args.timezone)
}

// Run a destructive tool after the user confirms. Re-validates args
// server-side (defense in depth).
export async function runConfirmedTool(
  args: RunArgs,
): Promise<{ result: Record<string, unknown> }> {
  if (!requiresConfirmation(args.name)) {
    throw new AppError(
      400,
      'tool_not_destructive',
      `${args.name} runs inline — no confirmation step`,
    )
  }
  const validated = validateToolArgs(args.name, args.args)
  return dispatch(args.userId, args.name, validated, args.timezone)
}

async function dispatch(
  userId: string,
  name: ToolName,
  validated: unknown,
  timezone: string | undefined,
): Promise<{ result: Record<string, unknown> }> {
  switch (name) {
    case 'createTask':
      return { result: await runCreate(userId, validated as CreateTaskArgs, timezone) }
    case 'updateTask':
      return { result: await runUpdate(userId, validated as UpdateTaskArgs, timezone) }
    case 'completeTask':
      return { result: await runComplete(userId, validated as CompleteTaskArgs) }
    case 'deleteTask':
      return { result: await runDelete(userId, validated as DeleteTaskArgs) }
    case 'deleteAllTasks':
      return { result: await runDeleteAll(userId, validated as DeleteAllTasksArgs) }
    case 'snoozeTask':
      return { result: await runSnooze(userId, validated as SnoozeTaskArgs, timezone) }
    case 'queryTasks':
      return { result: await runQuery(userId, validated as QueryTasksArgs, timezone) }
    case 'addSubtask':
      return { result: await runAddSubtask(userId, validated as AddSubtaskArgs) }
    case 'toggleSubtask':
      return { result: await runToggleSubtask(userId, validated as ToggleSubtaskArgs) }
    case 'removeSubtask':
      return { result: await runRemoveSubtask(userId, validated as RemoveSubtaskArgs) }
    case 'holdForClarification':
      return {
        result: await runHoldForClarification(userId, validated as HoldForClarificationArgs, timezone),
      }
  }
}

// Hold a fuzzy item for the user to resolve later (home banner → /clarify).
// Normalizes every date through the same path createTask uses so a picked
// option lands an identical dueAt to what createTask would have produced.
async function runHoldForClarification(
  userId: string,
  args: HoldForClarificationArgs,
  tz: string | undefined,
): Promise<Record<string, unknown>> {
  const out = await createClarification({
    userId,
    draft: {
      title: args.title,
      domain: args.domain,
      priority: args.priority ?? 'normal',
      notes: args.notes,
      tags: args.tags ?? [],
      dueAt: args.dueAtGuess ? normalizeLocalIso(args.dueAtGuess, tz) : undefined,
    },
    question: args.question,
    kind: args.kind,
    options: (args.options ?? []).map((o) => ({
      label: o.label,
      dueAt: o.dueAt ? normalizeLocalIso(o.dueAt, tz) : undefined,
      title: o.title,
      notes: o.notes,
    })),
  })
  return { ok: true, clarificationId: out.clarificationId, title: out.title }
}

async function runCreate(
  userId: string,
  args: CreateTaskArgs,
  tz: string | undefined,
): Promise<Record<string, unknown>> {
  const dueAt = args.dueAt ? normalizeLocalIso(args.dueAt, tz) : undefined
  const task = await Task.create({
    userId,
    title: args.title,
    domain: args.domain,
    kind: args.kind,
    priority: args.priority ?? 'normal',
    tags: args.tags ?? [],
    notes: args.notes,
    dueAt,
    status: 'open',
  })
  // Schedule smart reminders for reminder tasks (rules floor; AI may refine).
  if (task.kind === 'reminder' && task.dueAt) await setRulesReminders(task)
  return { task: task.toJSON() }
}

async function runUpdate(
  userId: string,
  args: UpdateTaskArgs,
  tz: string | undefined,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const set: Record<string, unknown> = {}
  const unset: Record<string, ''> = {}
  if (args.title !== undefined) set.title = args.title
  if (args.domain !== undefined) set.domain = args.domain
  if (args.priority !== undefined) set.priority = args.priority
  if (args.tags !== undefined) set.tags = args.tags
  if (args.dueAt !== undefined) set.dueAt = normalizeLocalIso(args.dueAt, tz)
  if (args.status !== undefined) {
    set.status = args.status
    if (args.status === 'done') set.completedAt = new Date()
  }
  if (args.notes !== undefined) {
    // null or empty string clears the field; non-empty string overwrites.
    if (args.notes && args.notes.length > 0) {
      set.notes = args.notes
    } else {
      unset.notes = ''
    }
  }
  const mutation: Record<string, unknown> = {}
  if (Object.keys(set).length > 0) mutation.$set = set
  if (Object.keys(unset).length > 0) mutation.$unset = unset
  const task = await Task.findOneAndUpdate(
    { _id: args.taskId, userId },
    mutation,
    { new: true },
  )
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  // dueAt moved → regenerate the reminder schedule from the new deadline.
  if (args.dueAt !== undefined && task.kind === 'reminder' && task.dueAt) {
    await setRulesReminders(task)
  }
  return { task: task.toJSON() }
}

async function runComplete(
  userId: string,
  args: CompleteTaskArgs,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const task = await Task.findOneAndUpdate(
    { _id: args.taskId, userId },
    { $set: { status: 'done', completedAt: new Date() } },
    { new: true },
  )
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  return { task: task.toJSON() }
}

async function runDelete(
  userId: string,
  args: DeleteTaskArgs,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const result = await Task.deleteOne({ _id: args.taskId, userId })
  if (result.deletedCount === 0) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  return { taskId: args.taskId, deleted: true }
}

function buildDeleteAllFilter(
  userId: string,
  args: DeleteAllTasksArgs,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { userId }
  if (args.domain) filter.domain = args.domain
  if (args.status) filter.status = args.status
  return filter
}

// Count the tasks a deleteAllTasks call would remove, from RAW (unvalidated)
// model args. Returns null when the args don't parse so the confirmation
// card falls back to a generic label rather than showing a wrong count.
export async function countTasksForBulkDelete(
  userId: string,
  rawArgs: unknown,
): Promise<number | null> {
  const parsed = deleteAllTasksArgs.safeParse(rawArgs)
  if (!parsed.success) return null
  return Task.countDocuments(buildDeleteAllFilter(userId, parsed.data))
}

// Bulk delete. An empty filter wipes every task the user owns; optional
// domain/status filters scope it. Deleting zero tasks is a no-op success
// (the user simply had nothing to clear), NOT a 404 — Mo reports the count.
async function runDeleteAll(
  userId: string,
  args: DeleteAllTasksArgs,
): Promise<Record<string, unknown>> {
  const result = await Task.deleteMany(buildDeleteAllFilter(userId, args))
  return {
    deleted: true,
    deletedCount: result.deletedCount ?? 0,
    domain: args.domain ?? null,
    status: args.status ?? null,
  }
}

async function runSnooze(
  userId: string,
  args: SnoozeTaskArgs,
  tz: string | undefined,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const snoozedUntil = normalizeLocalIso(args.until, tz)
  const task = await Task.findOneAndUpdate(
    { _id: args.taskId, userId },
    { $set: { status: 'snoozed', snoozedUntil } },
    { new: true },
  )
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  // Snooze = remind me again at the snooze moment.
  await setSnoozeReminder(task)
  return { task: task.toJSON() }
}

async function runQuery(
  userId: string,
  args: QueryTasksArgs,
  tz: string | undefined,
): Promise<Record<string, unknown>> {
  const filter: Record<string, unknown> = { userId }
  if (args.status) filter.status = args.status
  if (args.domain) filter.domain = args.domain
  if (args.priority) filter.priority = args.priority
  if (args.tag) {
    const normalized = normalizeTag(args.tag)
    if (normalized) filter.tags = normalized
  }
  if (args.dueBefore || args.dueAfter) {
    const dueAt: Record<string, Date> = {}
    if (args.dueBefore) dueAt.$lte = normalizeLocalIso(args.dueBefore, tz)
    if (args.dueAfter) dueAt.$gte = normalizeLocalIso(args.dueAfter, tz)
    filter.dueAt = dueAt
  }
  const tasks = await Task.find(filter)
    .sort({ dueAt: 1, createdAt: -1 })
    .limit(Math.min(args.limit ?? 50, 200))
  return {
    count: tasks.length,
    tasks: tasks.map((t) => t.toJSON()),
  }
}

async function runAddSubtask(
  userId: string,
  args: AddSubtaskArgs,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const task = await Task.findOne({ _id: args.taskId, userId })
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  if (task.subtasks.length >= MAX_SUBTASKS) {
    throw new AppError(
      400,
      'subtask_limit',
      `That task already has ${MAX_SUBTASKS} subtasks — clean some out before adding more.`,
    )
  }
  task.subtasks.push({ text: args.text, done: false })
  await task.save()
  return { task: task.toJSON() }
}

async function runToggleSubtask(
  userId: string,
  args: ToggleSubtaskArgs,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId) || !Types.ObjectId.isValid(args.subtaskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const task = await Task.findOne({ _id: args.taskId, userId })
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  const sub = task.subtasks.find((s) => String(s._id) === args.subtaskId)
  if (!sub) throw new AppError(404, 'subtask_not_found', 'Subtask no longer exists.')
  sub.done = args.done ?? !sub.done
  await task.save()
  return { task: task.toJSON() }
}

async function runRemoveSubtask(
  userId: string,
  args: RemoveSubtaskArgs,
): Promise<Record<string, unknown>> {
  if (!Types.ObjectId.isValid(args.taskId) || !Types.ObjectId.isValid(args.subtaskId)) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  const task = await Task.findOne({ _id: args.taskId, userId })
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  const before = task.subtasks.length
  task.subtasks = task.subtasks.filter((s) => String(s._id) !== args.subtaskId)
  if (task.subtasks.length === before) {
    throw new AppError(404, 'subtask_not_found', 'Subtask no longer exists.')
  }
  await task.save()
  return { task: task.toJSON() }
}
