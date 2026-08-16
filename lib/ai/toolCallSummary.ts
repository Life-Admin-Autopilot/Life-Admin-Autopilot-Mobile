// Pulls the correctable fields out of a tool call's persisted result.
//
// The ledger row used to show verb · title · date and nothing else, so the three
// decisions Kitto actually MADE on the user's behalf — which category it filed
// under, what priority it assigned, and whether the date will ever fire — were
// invisible. The user could only discover a wrong guess by leaving the chat and
// opening the matter. Surfacing them inline turns the receipt into something
// correctable in the next message: "make that urgent", "that's home not family".
//
// Every field here already rides on the wire (toolRunner returns the full
// `task.toJSON()`); this module only decides which calls carry them and narrows
// the untyped result bag.

import type { AiToolCall, AiToolName } from '@/lib/ai/types'
import type { TaskDomain, TaskKind, TaskPriority } from '@/queries/tasks'

// A task as it comes back on the wire — every field checked before it is
// trusted, so a shape drift on the server degrades to "no meta line", never to
// a crash mid-stream.
type WireTask = Record<string, unknown>

// Verbs that FILE something the user may want to correct. Deletes and reads
// leave nothing to adjust, completions are past tense, and the subtask verbs are
// about a step rather than the parent matter's own fields — a date/priority line
// under "Step added" would describe the wrong thing.
const FILING_TOOLS: ReadonlySet<AiToolName> = new Set([
  'createTask',
  'updateTask',
  'snoozeTask',
  'holdForClarification',
])

export interface ToolCallTaskFields {
  dueAt?: string
  priority: TaskPriority
  domain: TaskDomain
  /**
   * False when a date is on the matter but nothing will fire — the held
   * high-stakes case, where `kind` stays 'list' precisely so we never ring on a
   * date we invented. Showing the date without this would read as a promise.
   */
  willRemind: boolean
}

const PRIORITIES: ReadonlySet<string> = new Set(['low', 'normal', 'high', 'urgent'])
const DOMAINS: ReadonlySet<string> = new Set(['health', 'home', 'car', 'finance', 'family', 'pets'])

export function taskFieldsOf(call: AiToolCall): ToolCallTaskFields | null {
  if (!FILING_TOOLS.has(call.name)) return null
  if (call.status !== 'executed') return null

  const result = (call.result ?? {}) as Record<string, unknown>
  return taskFieldsFrom(result.task)
}

/**
 * The same narrowing, from a task that did not arrive on a tool call.
 *
 * Answering a held question returns the PATCHED task from
 * `POST /me/clarifications/:id/resolve`, and the card that asked the question
 * has to redraw itself from that — otherwise it keeps showing the guess it was
 * asking the user to correct, forever.
 */
export function taskFieldsFrom(value: unknown): ToolCallTaskFields | null {
  if (!value || typeof value !== 'object') return null
  const task = value as WireTask

  const priority = typeof task.priority === 'string' && PRIORITIES.has(task.priority)
    ? (task.priority as TaskPriority)
    : undefined
  const domain = typeof task.domain === 'string' && DOMAINS.has(task.domain)
    ? (task.domain as TaskDomain)
    : undefined
  if (!priority || !domain) return null

  const kind = task.kind as TaskKind | undefined
  const dueAt = typeof task.dueAt === 'string' ? task.dueAt : undefined

  return {
    dueAt,
    priority,
    domain,
    // No date at all is honest on its own ("No date") — the warning is only for
    // a date that is present but silent.
    willRemind: kind === 'reminder',
  }
}

// ---- Ledger rows ----
//
// What a quiet receipt row NAMES. Three of the eleven tools act on a step
// inside a matter and return the whole parent, so a row built from the result's
// title said "Step added — Go to the doctor" once per step: the same sentence
// three times, and never the thing that was actually added.

interface SubtaskRow {
  id: string
  text: string
  done: boolean
}

function subtaskRows(call: AiToolCall): SubtaskRow[] {
  const result = (call.result ?? {}) as Record<string, unknown>
  const task = result.task as WireTask | undefined
  const raw = Array.isArray(task?.subtasks) ? task.subtasks : []
  return raw.filter((row): row is SubtaskRow => {
    if (!row || typeof row !== 'object') return false
    const sub = row as WireTask
    return (
      typeof sub.id === 'string' && typeof sub.text === 'string' && typeof sub.done === 'boolean'
    )
  })
}

/** The step `toggleSubtask` flipped, read back off the saved parent. */
export function toggledSubtask(call: AiToolCall): SubtaskRow | null {
  if (call.name !== 'toggleSubtask') return null
  const id = typeof call.args.subtaskId === 'string' ? call.args.subtaskId : null
  if (!id) return null
  return subtaskRows(call).find((row) => row.id === id) ?? null
}

/**
 * The step text a subtask row should name, or null when the call is about the
 * matter itself. `addSubtask` carries it in the args and nowhere else;
 * `removeSubtask` has already deleted it, so that row names the parent instead.
 */
export function subtaskTextOf(call: AiToolCall): string | null {
  if (call.name === 'addSubtask') {
    const text = typeof call.args.text === 'string' ? call.args.text.trim() : ''
    return text.length > 0 ? text : null
  }
  return toggledSubtask(call)?.text ?? null
}

/** How many matters a read matched. Null when the tool returned no count. */
export function queryMatchCount(call: AiToolCall): number | null {
  if (call.name !== 'queryTasks') return null
  const result = (call.result ?? {}) as Record<string, unknown>
  return typeof result.count === 'number' ? result.count : null
}

/**
 * The catalogue key under `chat.ledger.verb.*`.
 *
 * `toggleSubtask` splits in two, because "Step updated" described ticking a
 * step and un-ticking it identically — which is the one thing that row exists
 * to say. The unsplit key survives as the fallback for a result too old or too
 * thin to say which way it went.
 */
export type LedgerVerb = AiToolName | 'toggleSubtaskDone' | 'toggleSubtaskOpen'

export function ledgerVerbOf(call: AiToolCall): LedgerVerb {
  if (call.name !== 'toggleSubtask') return call.name
  const done =
    toggledSubtask(call)?.done ?? (typeof call.args.done === 'boolean' ? call.args.done : null)
  if (done === null) return 'toggleSubtask'
  return done ? 'toggleSubtaskDone' : 'toggleSubtaskOpen'
}
