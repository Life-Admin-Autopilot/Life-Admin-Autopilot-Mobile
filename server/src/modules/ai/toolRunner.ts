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
  normalizeEstimate,
  normalizeTag,
  notDeleted,
} from '../../models/Task'
import { applyBulk } from '../tasks/bulkService'
import { buildTaskFilter } from '../tasks/taskQuery'

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
import { CLARIFICATION_COSTS } from '../../models/Clarification'
import { createClarification } from '../clarifications/createClarification'
import { dropOpenClarifications } from '../clarifications/dropOpenClarifications'
import { isAtOpenClarificationCap } from '../clarifications/openClarificationCap'
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

// Bucket labels, matching the function declaration's string enum. Accepted as a
// number too so a model that answers 30 instead of "30" is snapped, not
// rejected — losing a whole createTask over the JSON type of an optional hint
// would be a worse outcome than an approximate estimate.
const estimateBound = z.union([z.string().max(8), z.number()])

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
    estimateMinMinutes: estimateBound.optional(),
    estimateMaxMinutes: estimateBound.optional(),
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
  // Promotes a passive 'list' item to a firing 'reminder' (or back). This is
  // how a task whose reminder was WITHHELD on an uncertain high-stakes date
  // starts firing once the user confirms it.
  kind: z.enum(TASK_KINDS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  // Full replace — send the desired final tag list, NOT a delta.
  tags: tagArrayInput.optional(),
  dueAt: isoString.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  // Empty string or null clears notes. Omit to leave unchanged.
  notes: z.string().max(2000).nullable().optional(),
  estimateMinMinutes: estimateBound.optional(),
  estimateMaxMinutes: estimateBound.optional(),
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

// Mirrors the Matters list filters (modules/tasks/taskQuery). Keep the two in
// step: if the UI can express a filter the agent can't, "show me what's on that
// screen" stops working — and the user has no way to know why.
export const queryTasksArgs = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  domain: z.enum(DOMAINS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  tag: z.string().max(64).optional(),
  dueBefore: isoString.optional(),
  dueAfter: isoString.optional(),
  overdue: z.boolean().optional(),
  undated: z.boolean().optional(),
  untagged: z.boolean().optional(),
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
// later. This is how Kitto "asks" now — NOT free-text in the reply.
export const holdForClarificationArgs = z.object({
  // The task Kitto creates RIGHT NOW, question or no question.
  title: z.string().trim().min(1).max(240),
  domain: z.enum(DOMAINS),
  priority: z.enum(TASK_PRIORITIES).optional(),
  tags: tagArrayInput.optional(),
  notes: z.string().max(2000).optional(),
  // Best-guess due date, if any — the task is created with it provisionally.
  dueAtGuess: isoString.optional(),
  // The specific question to ask ("Is it the 15th or the 18th?").
  question: z.string().trim().min(1).max(300),
  kind: z.enum(['date', 'detail', 'choice']),
  // What a wrong guess costs. 'low' → the reminder may fire on the guess;
  // 'high' → the task is created but stays passive until the user confirms.
  // Defaults to 'high' when the model doesn't say.
  costOfWrong: z.enum(CLARIFICATION_COSTS).optional(),
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
  // The best guess we have for the date, in priority order: an explicit guess,
  // else the model's most-likely option (it orders them).
  const guess = args.dueAtGuess ?? args.options?.[0]?.dueAt
  const dueAt = guess ? normalizeLocalIso(guess, tz) : undefined

  // ALWAYS create the task, question or no question. Withholding it left the
  // captured item invisible — not in Matters, not searchable, not deletable —
  // until the user answered. What gets withheld now is the REMINDER, and only
  // when a wrong date is expensive: a 'high' cost item lands as a passive list
  // entry that won't fire until confirmed, while a 'low' cost one is free to
  // nudge on the guess because being wrong just means rescheduling.
  const costOfWrong = args.costOfWrong ?? 'high'
  const created = await runCreate(
    userId,
    {
      title: args.title,
      domain: args.domain,
      kind: dueAt && costOfWrong === 'low' ? 'reminder' : 'list',
      priority: args.priority ?? 'normal',
      tags: args.tags ?? [],
      notes: args.notes,
      ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    } as CreateTaskArgs,
    tz,
  )
  const task = created.task as { id: string }

  // Queue full → the task above is the whole answer; skip the question rather
  // than growing a pile the user never reaches.
  if (await isAtOpenClarificationCap(userId)) {
    return { ok: true, clarificationId: null, queueFull: true, title: args.title, ...created }
  }

  const out = await createClarification({
    userId,
    taskId: task.id,
    draft: {
      title: args.title,
      domain: args.domain,
      priority: args.priority ?? 'normal',
      notes: args.notes,
      tags: args.tags ?? [],
      dueAt,
    },
    question: args.question,
    kind: args.kind,
    costOfWrong,
    options: (args.options ?? []).map((o) => ({
      label: o.label,
      dueAt: o.dueAt ? normalizeLocalIso(o.dueAt, tz) : undefined,
      title: o.title,
      notes: o.notes,
    })),
  })
  return { ok: true, clarificationId: out.clarificationId, taskId: task.id, title: out.title, ...created }
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
    estimate: normalizeEstimate(
      { minMinutes: args.estimateMinMinutes, maxMinutes: args.estimateMaxMinutes },
      'ai',
    ),
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
  if (args.kind !== undefined) set.kind = args.kind
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
  // Written as its own guarded update rather than folded into $set below: a
  // user-set estimate is authoritative forever, and the `$ne: 'user'` filter is
  // what enforces that. It also matches tasks with no estimate at all (a missing
  // field is not equal to 'user'), so a first AI estimate still lands.
  const estimate = normalizeEstimate(
    { minMinutes: args.estimateMinMinutes, maxMinutes: args.estimateMaxMinutes },
    'ai',
  )
  if (estimate) {
    await Task.updateOne(
      { _id: args.taskId, userId, ...notDeleted(), 'estimate.source': { $ne: 'user' } },
      { $set: { estimate } },
    )
  }

  const mutation: Record<string, unknown> = {}
  if (Object.keys(set).length > 0) mutation.$set = set
  if (Object.keys(unset).length > 0) mutation.$unset = unset
  const filter = { _id: args.taskId, userId, ...notDeleted() }
  // An estimate-only update leaves nothing for the main mutation to do, and an
  // empty update document is a driver error — read the row back instead.
  const task =
    Object.keys(mutation).length > 0
      ? await Task.findOneAndUpdate(filter, mutation, { new: true })
      : await Task.findOne(filter)
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  // dueAt moved, or the task just became a reminder (a withheld date being
  // confirmed) → regenerate the schedule from the deadline that now stands.
  if ((args.dueAt !== undefined || args.kind === 'reminder') && task.kind === 'reminder' && task.dueAt) {
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
    { _id: args.taskId, userId, ...notDeleted() },
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
  // Soft delete via the shared bulk service — the agent gets no delete path the
  // user can't reverse. `undoToken` rides back in the tool result so the chat
  // receipt can offer Undo inline.
  const result = await applyBulk(userId, { ids: [args.taskId] }, { action: 'delete' })
  if (result.affected === 0) {
    throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  }
  return { taskId: args.taskId, deleted: true, undoToken: result.undoToken }
}

function buildDeleteAllFilter(
  userId: string,
  args: DeleteAllTasksArgs,
): Record<string, unknown> {
  const filter: Record<string, unknown> = { userId, ...notDeleted() }
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
// (the user simply had nothing to clear), NOT a 404 — Kitto reports the count.
async function runDeleteAll(
  userId: string,
  args: DeleteAllTasksArgs,
): Promise<Record<string, unknown>> {
  // Soft delete, one reversible transaction — even for "clear everything".
  // The confirmation gate in service.ts is the speed bump; THIS is the seatbelt.
  const result = await applyBulk(
    userId,
    {
      filter: {
        ...(args.domain ? { domain: [args.domain] } : {}),
        ...(args.status ? { status: [args.status] } : {}),
      },
    },
    { action: 'delete' },
    { label: 'Cleared from chat' },
  )
  // Held items aren't tasks yet, so the wipe above can't reach them — drop them
  // explicitly or "clear everything" leaves questions standing on the dashboard.
  // Skipped for a status-scoped wipe: a held item has no task status to match.
  const { droppedCount } = args.status
    ? { droppedCount: 0 }
    : await dropOpenClarifications({ userId, domain: args.domain })
  return {
    deleted: true,
    deletedCount: result.affected,
    droppedQuestionCount: droppedCount,
    undoToken: result.undoToken,
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
    { _id: args.taskId, userId, ...notDeleted() },
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
  // Same filter builder the Matters list uses, so the agent and the screen can
  // never disagree about what "overdue" or "untagged" means. Dates are
  // normalized against the caller's tz first — the model emits naive ISO.
  const filter = buildTaskFilter(userId, {
    q: args.q,
    status: args.status ? [args.status] : undefined,
    domain: args.domain ? [args.domain] : undefined,
    priority: args.priority ? [args.priority] : undefined,
    kind: args.kind ? [args.kind] : undefined,
    tag: args.tag,
    dueBefore: args.dueBefore ? normalizeLocalIso(args.dueBefore, tz) : undefined,
    dueAfter: args.dueAfter ? normalizeLocalIso(args.dueAfter, tz) : undefined,
    overdue: args.overdue,
    undated: args.undated,
    untagged: args.untagged,
  })
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
  const task = await Task.findOne({ _id: args.taskId, userId, ...notDeleted() })
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
  const task = await Task.findOne({ _id: args.taskId, userId, ...notDeleted() })
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
  const task = await Task.findOne({ _id: args.taskId, userId, ...notDeleted() })
  if (!task) throw new AppError(404, 'task_not_found', 'That matter could not be found — it may already have been removed.')
  const before = task.subtasks.length
  task.subtasks = task.subtasks.filter((s) => String(s._id) !== args.subtaskId)
  if (task.subtasks.length === before) {
    throw new AppError(404, 'subtask_not_found', 'Subtask no longer exists.')
  }
  await task.save()
  return { task: task.toJSON() }
}
