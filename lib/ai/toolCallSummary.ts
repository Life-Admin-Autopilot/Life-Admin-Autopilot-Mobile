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

// The result bag is `Record<string, unknown>` on the wire, so every field is
// checked before it is trusted — a shape drift on the server degrades to "no
// meta line", never to a crash mid-stream.
export function taskFieldsOf(call: AiToolCall): ToolCallTaskFields | null {
  if (!FILING_TOOLS.has(call.name)) return null
  if (call.status !== 'executed') return null

  const result = (call.result ?? {}) as Record<string, unknown>
  const task = result.task as Record<string, unknown> | undefined
  if (!task) return null

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
