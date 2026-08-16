// Narrows `holdForClarification` tool calls into the shape the chat card renders.
//
// Pure: no React, no I/O. The card is a form over untyped wire data — args come
// back as `Record<string, unknown>` and the result bag is whatever the tool
// returned — so every field is checked here once, and the component below can
// assume it holds real values.
//
// The one field that must survive verbatim is the option INDEX: resolving a
// clarification sends `{ type: 'option', index }` and the server reads that
// index against ITS OWN options array. Re-sorting, de-duplicating, or
// re-numbering the options client-side would silently answer a different
// question than the one the user tapped.

import { taskFieldsOf, type ToolCallTaskFields } from '@/lib/ai/toolCallSummary'
import type { AiToolCall } from '@/lib/ai/types'
import { TASK_DOMAINS, type TaskDomain } from '@/queries/tasks'

export interface HoldOption {
  label: string
  /** Position in the SERVER's options array. Sent to /resolve unchanged. */
  index: number
}

export interface ParsedHold {
  callId: string
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

const DOMAINS: ReadonlySet<string> = new Set(TASK_DOMAINS)

function optionsOf(args: Record<string, unknown>): HoldOption[] {
  const raw = Array.isArray(args.options) ? args.options : []
  return raw
    .map((option, index) => ({
      label: option && typeof option === 'object' ? (option as Record<string, unknown>).label : null,
      index,
    }))
    .filter(
      (option): option is HoldOption =>
        typeof option.label === 'string' && option.label.trim().length > 0,
    )
}

export function parseHold(call: AiToolCall): ParsedHold {
  const args = call.args
  const rawId = call.result?.clarificationId
  const domain = typeof args.domain === 'string' && DOMAINS.has(args.domain) ? args.domain : null
  // Prefer the persisted title: the server normalizes it, and it is the title
  // the matter now carries in the list.
  const task = call.result?.task as Record<string, unknown> | undefined
  const savedTitle = typeof task?.title === 'string' ? task.title.trim() : ''
  const argTitle = typeof args.title === 'string' ? args.title.trim() : ''

  return {
    callId: call.callId,
    clarificationId: typeof rawId === 'string' && rawId.length > 0 ? rawId : null,
    question: typeof args.question === 'string' ? args.question.trim() : '',
    title: savedTitle || argTitle,
    domain: domain as TaskDomain | null,
    options: optionsOf(args),
    facts: taskFieldsOf(call),
  }
}

export function parseHolds(calls: readonly AiToolCall[]): ParsedHold[] {
  return calls.map(parseHold)
}

/** What the user staged for one row. `optionIndex` null → they typed it. */
export interface HoldAnswer {
  label: string
  optionIndex: number | null
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
