// Per-turn renderer.
//   user      → right-aligned crimson bubble, white text
//   assistant → left-aligned marble card with inline citation chips + stacked
//               tool-call / clarification cards below
//
// A streaming assistant turn shows a static caret (handled by AssistantText) or
// three dots before the first token arrives.

import { AssistantText } from '@/components/chat/AssistantText'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { ClarificationDeck } from '@/components/chat/ClarificationDeck'
import type { AiMessage } from '@/lib/ai/types'

interface ChatMessageProps {
  message: AiMessage
  streaming?: boolean
  onConfirm: (callId: string) => void
  onDecline: (callId: string) => void
  onAnswer: (text: string) => void
  pendingConfirm?: { callId: string; action: 'confirm' | 'decline' } | null
}

export function ChatMessage({
  message,
  streaming = false,
  onConfirm,
  onDecline,
  onAnswer,
  pendingConfirm = null,
}: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-accent px-3.5 py-2 text-body-sm text-accent-ink" dir="auto">
          {message.text}
        </div>
      </div>
    )
  }

  const hasText = message.text.length > 0
  const hasTools = message.toolCalls.length > 0

  // Receipts = executed/failed mutations → quiet ledger rows.
  // Confirms = the bulk-delete prompt (its own card).
  // Clarifications = all held questions → ONE consolidated deck, not a stack.
  const receipts = message.toolCalls.filter(
    (c) => c.name !== 'holdForClarification' && c.status !== 'pending_confirmation',
  )
  const confirms = message.toolCalls.filter(
    (c) => c.name !== 'holdForClarification' && c.status === 'pending_confirmation',
  )
  const clarifications = message.toolCalls.filter((c) => c.name === 'holdForClarification')

  // Prose lives in the grey bubble; tool/clarification cards render standalone
  // below it (never nested inside the bubble — that read as a box-in-a-box).
  return (
    <div className="flex max-w-[88%] flex-col items-start gap-2">
      {hasText ? (
        <div className="rounded-2xl bg-surface-sunken px-3.5 py-2.5">
          <AssistantText text={message.text} sources={message.sources} streaming={streaming} />
        </div>
      ) : streaming && !hasTools ? (
        <div className="rounded-2xl bg-surface-sunken px-3.5 py-2.5">
          <StreamingDots />
        </div>
      ) : null}

      {hasTools ? (
        <div className="flex w-full flex-col gap-2">
          {/* Receipts (executed / failed mutations) stack as a tight ledger,
              closed by a single hairline rule. The bulk-delete confirm card and
              the clarification cards render as standalone cards below. */}
          {receipts.length > 0 ? (
            <div className="w-full border-b border-border/60 pb-1">
              {receipts.map((call) => (
                <ToolCallCard
                  key={call.callId}
                  call={call}
                  onConfirm={onConfirm}
                  onDecline={onDecline}
                />
              ))}
            </div>
          ) : null}

          {confirms.map((call) => (
            <ToolCallCard
              key={call.callId}
              call={call}
              onConfirm={onConfirm}
              onDecline={onDecline}
              pendingAction={pendingConfirm?.callId === call.callId ? pendingConfirm.action : null}
            />
          ))}

          {clarifications.length > 0 ? (
            <ClarificationDeck calls={clarifications} onAnswer={onAnswer} disabled={streaming} />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// Three-dot indicator for the moment between request send and first token.
function StreamingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1">
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:0ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:300ms]" />
    </div>
  )
}
