// The in-flight assistant turn — pure reducers over a draft message.
//
// Both entry points into a turn (ask() and the post-confirmation continuation)
// consume the SAME stream shape, and used to carry their own copy of this
// event handling. Two copies meant a protocol addition landed in one and not
// the other; text_reset would have been exactly that bug. They share it now.

import type { AiMessage, AiSource, AiToolCall, AskEvent } from '@/lib/ai/types'

export function emptyMessage(role: 'user' | 'assistant'): AiMessage {
  return { role, text: '', sources: [], toolCalls: [], createdAt: new Date().toISOString() }
}

/**
 * An assistant turn that neither said nor did anything.
 *
 * Sources are deliberately NOT counted as content: retrieval running is not an
 * answer, and a turn that cited three matters and then said nothing is exactly
 * as silent to the user as one that cited none.
 */
export function isSilent(message: Pick<AiMessage, 'text' | 'toolCalls'>): boolean {
  return message.text.trim().length === 0 && message.toolCalls.length === 0
}

function mergeSources(existing: AiSource[], incoming: AiSource[]): AiSource[] {
  const seen = new Set(existing.map((s) => `${s.kind}:${s.id}`))
  const fresh = incoming.filter((s) => !seen.has(`${s.kind}:${s.id}`))
  return fresh.length > 0 ? [...existing, ...fresh] : existing
}

/**
 * Fold one stream event into the draft, returning a new message.
 *
 * Returns null for events that don't belong to the draft (done, error, quota,
 * conversation, and tool_result — which the caller routes, because a
 * continuation's first tool_result patches a message from an EARLIER turn).
 */
export function applyDraftEvent(draft: AiMessage, event: AskEvent): AiMessage | null {
  switch (event.type) {
    case 'sources':
      return { ...draft, sources: mergeSources(draft.sources, event.sources) }
    case 'token':
      return { ...draft, text: draft.text + event.text }
    case 'text_reset':
      // The model guessed before its tools ran and the server retracted it.
      // Sources and tool calls survive — only the prose was provisional.
      return { ...draft, text: '' }
    case 'tool_call': {
      const call: AiToolCall = {
        callId: event.callId,
        name: event.name,
        args: event.args,
        status: event.needsConfirmation ? 'pending_confirmation' : 'executed',
        result: null,
        error: null,
      }
      return { ...draft, toolCalls: [...draft.toolCalls, call] }
    }
    default:
      return null
  }
}

/** Resolve a tool call in whichever message carries it. */
export function applyToolResult(
  message: AiMessage,
  callId: string,
  outcome: { status: AiToolCall['status']; result: Record<string, unknown> | null; error: string | null },
): AiMessage {
  if (!message.toolCalls.some((t) => t.callId === callId)) return message
  return {
    ...message,
    toolCalls: message.toolCalls.map((t) =>
      t.callId === callId
        ? { ...t, status: outcome.status, result: outcome.result, error: outcome.error }
        : t,
    ),
  }
}
