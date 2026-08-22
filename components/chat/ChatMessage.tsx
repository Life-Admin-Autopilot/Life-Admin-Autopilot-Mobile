// Per-turn renderer.
//   user      → right-aligned purple bubble, white text
//   assistant → left-aligned lavender card with inline citation chips + stacked
//               tool-call / clarification cards below
//
// A streaming assistant turn shows a static caret (handled by AssistantText) or,
// before the first token arrives, the dots and — once the silence runs long —
// a status label (StreamingStatus).

import { AssistantText } from '@/components/chat/AssistantText'
import { StreamingStatus } from '@/components/chat/StreamingStatus'
import { ToolCallCard } from '@/components/chat/ToolCallCard'
import { ClarificationDeck } from '@/components/chat/ClarificationDeck'
import { raisesQuestions } from '@/lib/ai/clarificationHolds'
import { taskFieldsOf } from '@/lib/ai/toolCallSummary'
import type { AiMessage } from '@/lib/ai/types'
import { cn } from '@/lib/cn'

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

  // Receipts = executed/failed mutations → a card when a matter was filed,
  //            a quiet ledger row otherwise (ToolCallCard owns that split).
  // Confirms = the bulk-delete prompt (its own card).
  // Clarifications = every held matter → ONE card, facts and questions together.
  //
  // A held matter gets NO receipt of its own. It briefly did: the hold files the
  // task the moment it runs, so it looked like a filing that had earned one. But
  // that put one matter on two surfaces — a receipt stating the guess, a card
  // asking about it — and the receipt could not hear the answer. It went on
  // reading "needs a detail", "won't remind", and the guessed time long after
  // the user had corrected all three. The clarification card carries the facts
  // now, and updates them when it is answered.
  //
  // `raisesQuestions`, not `name === 'holdForClarification'`: createTask now
  // comes back carrying question rows too, whenever the server spotted a gap in
  // what was just filed. Same situation as a hold — one matter, saved, with
  // something still to ask — so it takes the same card, for the same reason a
  // held matter gets no separate receipt.
  const receipts = message.toolCalls.filter(
    (c) => c.status !== 'pending_confirmation' && !raisesQuestions(c),
  )
  const confirms = message.toolCalls.filter(
    (c) => !raisesQuestions(c) && c.status === 'pending_confirmation',
  )
  const clarifications = message.toolCalls.filter(raisesQuestions)

  // A receipt that filed a matter renders as a card (see ToolCallCard). The
  // container needs to know before it lays the stack out.
  const hasFiledReceipt = receipts.some((c) => taskFieldsOf(c) !== null)

  // Prose lives in the grey bubble; tool/clarification cards render standalone
  // below it (never nested inside the bubble — that read as a box-in-a-box).
  return (
    <div className="flex max-w-[88%] flex-col items-start gap-2">
      {hasText ? (
        <div className="rounded-2xl bg-surface-sunken px-3.5 py-2.5">
          <AssistantText text={message.text} sources={message.sources} streaming={streaming} />
        </div>
      ) : streaming ? (
        // Tools running with no prose yet used to render nothing at all: the
        // turn that does the most work was the one that showed the least.
        <div className="rounded-2xl bg-surface-sunken px-3.5 py-2.5">
          <StreamingStatus working={hasTools} />
        </div>
      ) : null}

      {hasTools ? (
        <div className="flex w-full flex-col gap-2">
          {/* Receipts (executed / failed mutations). Rows stack as a tight
              ledger closed by a single hairline rule; a filed matter renders as
              a card instead, and a card needs air around it rather than a rule
              underneath — a hairline hung off the bottom of a shadowed card
              reads as a broken border. One filed matter in the batch switches
              the whole stack to the spaced treatment, so a mixed turn does not
              get a rule running under half of it. The bulk-delete confirm and
              the clarification cards render standalone below. */}
          {receipts.length > 0 ? (
            <div
              className={cn(
                'flex w-full flex-col',
                hasFiledReceipt ? 'gap-2' : 'border-b border-border/60 pb-1',
              )}
            >
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
