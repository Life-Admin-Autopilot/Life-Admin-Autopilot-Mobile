// Narrows `holdForClarification` tool calls into the shape the chat card renders.
//
// Pure: no React, no I/O. The card is a form over untyped wire data — args come
// back as `Record<string, unknown>` and the result bag is whatever the tool
// returned — so every field is checked here once, and the component below can
// assume it holds real values.
//
// ONE hold call can now raise SEVERAL questions about ONE matter — a date
// ("What time?") and a detail ("Which friend are you visiting?") — so the result
// carries a `clarifications` array of RECEIPTS: `{ id, taskId, question, kind,
// costOfWrong, options }`, all sharing one taskId. Deliberately small (it lands
// in the model's context too), so there is no draft and no status here; those
// live on `GET /me/clarifications`.
//
// The back-compat axis is the OPTION, not the envelope. A transcript written
// before this change has `result.clarification` — the same receipt, singular —
// but its options are bare STRINGS rather than `{ label, dueAt? }` objects, so
// both are read. Reading only the object form would strip every chip off every
// question in the history and leave a free-text box where the answer used to be
// one tap.
//
// The one field that must survive verbatim is the option INDEX: resolving a
// clarification sends `{ type: 'option', index }` and the server reads that
// index against ITS OWN options array — per ROW, not per call. Re-sorting,
// de-duplicating, or re-numbering the options client-side would silently answer
// a different question than the one the user tapped. Dropping an unlabelled
// option must therefore not renumber the ones after it.

import { taskFieldsOf, taskFieldsFrom, type ToolCallTaskFields } from '@/lib/ai/toolCallSummary'
import type { AiToolCall } from '@/lib/ai/types'
import { TASK_DOMAINS, type TaskDomain } from '@/queries/tasks'

export interface HoldOption {
  label: string
  /** Position in the SERVER's options array for THIS row. Sent to /resolve unchanged. */
  index: number
}

/** One question. A hold call contributes one row per clarification it raised. */
export interface ParsedHold {
  /** Unique per QUESTION — the deck keys every piece of row state on it. */
  rowKey: string
  callId: string
  /**
   * The matter the question is about. Rows that share it share one facts block,
   * because they are corrections to the same filed thing. Null when the result
   * named no task (a failed hold, or a transcript written before the task rode
   * back), and the row stands alone.
   */
  taskId: string | null
  /** The persisted Clarification row. Null → resolve via the chat fallback. */
  clarificationId: string | null
  /** Empty when the tool sent none — the card supplies translated copy. */
  question: string
  title: string
  domain: TaskDomain | null
  options: HoldOption[]
  /**
   * What was FILED when the question was raised — date, priority, domain, and
   * whether the date will fire. A hold creates the task before it asks, so the
   * card can show the guess it is asking about. Null when the tool call saved
   * nothing (a failed hold, or history written before the task rode back on the
   * result), and the card falls back to a title-only line.
   */
  facts: ToolCallTaskFields | null
}

/** One matter and every question raised about it, in the order asked. */
export interface HoldGroup {
  /** The matter's id, or the call when the hold saved no task. */
  key: string
  title: string
  domain: TaskDomain | null
  facts: ToolCallTaskFields | null
  rows: ParsedHold[]
}

const DOMAINS: ReadonlySet<string> = new Set(TASK_DOMAINS)

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * One option's label, from either shape it has been written in.
 *
 * A receipt written today carries `{ label, dueAt? }`; one written before the
 * multi-question change carries the label as a bare string. Both are one tap in
 * the card, and reading only the object form would silently strip the chips off
 * every question already in the transcript.
 */
function labelOf(option: unknown): string {
  if (typeof option === 'string') return option.trim()
  return isRecord(option) ? trimmed(option.label) : ''
}

// Index is taken BEFORE the empty labels are dropped: it addresses the server's
// array, not this one, so renumbering the survivors would answer the wrong
// option.
function optionsOf(raw: unknown): HoldOption[] {
  const list = Array.isArray(raw) ? raw : []
  return list
    .map((option, index) => ({ label: labelOf(option), index }))
    .filter((option) => option.label.length > 0)
}

/**
 * The persisted question receipts on a hold result, newest shape first.
 *
 * `clarifications` is the array; `clarification` is its first row, and the only
 * one a transcript written before the change has. Empty means the call
 * persisted no question at all — a failed hold, or one that hit the queue cap —
 * and the caller falls back to the args so the matter is still named.
 */
function wireRows(result: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  if (!result) return []
  const many = Array.isArray(result.clarifications) ? result.clarifications.filter(isRecord) : []
  if (many.length > 0) return many
  return isRecord(result.clarification) ? [result.clarification] : []
}

/** Every question one hold call raised. One entry for the single-question case. */
export function parseHoldRows(call: AiToolCall): ParsedHold[] {
  const args = call.args
  const result = call.result
  const domain = typeof args.domain === 'string' && DOMAINS.has(args.domain) ? args.domain : null
  // Prefer the persisted title: the server normalizes it, and it is the title
  // the matter now carries in the list.
  const task = result?.task as Record<string, unknown> | undefined
  const title = trimmed(task?.title) || trimmed(args.title)
  const facts = taskFieldsOf(call)
  // The hold result names its task ONLY through the task it saved and the
  // receipts' own taskId — there is no top-level `taskId` on it.
  const callTaskId = trimmed(task?.id) || null

  const shared = {
    callId: call.callId,
    title,
    domain: domain as TaskDomain | null,
    facts,
  }

  const rows = wireRows(result)
  if (rows.length === 0) {
    // No question was persisted, so there is nothing to resolve against: the
    // card asks what the ARGS say it meant to ask, and the answer rides back
    // through the chat. `clarificationId` is read as a courtesy — the hold that
    // saves a row always ships the row itself.
    const looseId = trimmed(result?.clarificationId)
    return [
      {
        ...shared,
        rowKey: call.callId,
        taskId: callTaskId,
        clarificationId: looseId.length > 0 ? looseId : null,
        question: trimmed(args.question),
        options: optionsOf(args.options),
      },
    ]
  }

  return rows.map((row, index) => {
    const id = trimmed(row.id) || (index === 0 ? trimmed(result?.clarificationId) : '')
    return {
      ...shared,
      // The id when there is one: it survives a re-render that reorders nothing
      // but would otherwise reuse a positional key across two different rows.
      rowKey: `${call.callId}:${id || index}`,
      taskId: trimmed(row.taskId) || callTaskId,
      clarificationId: id.length > 0 ? id : null,
      question: trimmed(row.question),
      options: optionsOf(row.options),
    }
  })
}

export function parseHolds(calls: readonly AiToolCall[]): ParsedHold[] {
  return calls.flatMap(parseHoldRows)
}

/**
 * One group per MATTER, in the order the questions were asked.
 *
 * Two questions about the same filed thing get one facts block between them —
 * repeating the chip, title, date and priority above each question would
 * describe one matter twice on one card, which is the duplication this card was
 * rebuilt to remove. Rows with no task id are their own group: nothing says
 * they belong together.
 */
export function groupHolds(holds: readonly ParsedHold[]): HoldGroup[] {
  const groups: HoldGroup[] = []
  const byKey = new Map<string, HoldGroup>()

  for (const hold of holds) {
    const key = hold.taskId ?? hold.rowKey
    const existing = byKey.get(key)
    if (existing) {
      existing.rows.push(hold)
      // A later row may carry facts the first one lacked; never drop what we have.
      if (!existing.facts && hold.facts) existing.facts = hold.facts
      if (!existing.title && hold.title) existing.title = hold.title
      continue
    }
    const group: HoldGroup = {
      key,
      title: hold.title,
      domain: hold.domain,
      facts: hold.facts,
      rows: [hold],
    }
    byKey.set(key, group)
    groups.push(group)
  }

  return groups
}

/** What the user staged for one row. `optionIndex` null → they typed it. */
export interface HoldAnswer {
  label: string
  optionIndex: number | null
}

/**
 * The matter as the server left it after an answer was written.
 *
 * Answering patches the task — a date answer sets the real dueAt and lets the
 * reminder fire, a detail answer can rewrite the title — and the shared facts
 * block redraws from this instead of the guess it was asking about.
 */
export interface ResolvedMatter {
  facts: ToolCallTaskFields | null
  title: string
}

/**
 * Fold a resolve response's task into what the card already knew.
 *
 * Field-wise rather than wholesale: sibling questions resolve one after another
 * and a thinner reply must not erase a title or a set of fields an earlier one
 * established.
 */
export function resolvedMatterFrom(task: unknown, prev?: ResolvedMatter): ResolvedMatter {
  const title = isRecord(task) ? trimmed(task.title) : ''
  return {
    facts: taskFieldsFrom(task) ?? prev?.facts ?? null,
    title: title || prev?.title || '',
  }
}

/**
 * The IANA zone the answer was given in.
 *
 * A date answer ("Monday", "6pm") is resolved server-side against a wall clock,
 * so the zone travels with it. Guarded because a locked-down webview can throw
 * out of `resolvedOptions()`, and a missing zone is a server default, not a
 * broken save.
 */
export function localTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}
