// Renders one tool call below an assistant message.
//
// Since the agent acts directly on every per-item mutation, a tool call is
// almost always a passive RECEIPT of what the assistant did. Two shapes carry
// that, split on whether there is anything left to correct:
//
//   FILED (create / update / snooze) — a real card. These verbs put a matter in
//     the list with three values Kitto GUESSED on the user's behalf: when, how
//     urgent, which part of your life. A ledger line rendered them at caption
//     weight next to everything else, which is the uniform-emphasis failure —
//     the eye skips the row, the wrong guess ships. The card gives the matter
//     the same emoji-chip-and-title shape it will have in the list, so the
//     receipt is recognisably the thing that was filed, and puts each guess in
//     its own pill: legible at a glance, one message away from a correction.
//
//   EVERYTHING ELSE (delete / query / subtasks) — the quiet ledger row it
//     always was. These leave no guess behind, so a card would be a box around
//     a fact nobody needs to check.
//
// A HELD matter is filed too, but it never reaches this file: ChatMessage
// routes `holdForClarification` to the clarification card, which renders the
// same facts above its question. Two cards for one matter is what this split
// used to produce, and the receipt half went on saying "needs a detail" after
// the question had been answered.
//
// The single interactive exception is the bulk `deleteAllTasks` wipe, which
// still pauses for a Confirm / Decline card because it is irreversible.
//
// Institutional voice: state the action, no chatter — the product noun is
// "matter". A completion is a status change, not an event.

import { Check, X } from 'lucide-react'
import { DraftConfirm } from '@/components/chat/DraftConfirm'
import { SavedConflictCard } from '@/components/chat/SavedConflictCard'
import { useTranslations } from 'next-intl'

import { MatterFacts } from '@/components/chat/MatterFacts'
import { Button } from '@/components/ui/button'
import {
  ledgerVerbOf,
  queryMatchCount,
  subtaskTextOf,
  taskFieldsOf,
  type ToolCallTaskFields,
} from '@/lib/ai/toolCallSummary'
import type { AiToolCall } from '@/lib/ai/types'

type PendingAction = 'confirm' | 'decline' | null

interface ToolCallCardProps {
  call: AiToolCall
  onConfirm: (callId: string) => void
  onDecline: (callId: string) => void
  /** Which action the user just initiated on THIS call (null otherwise). */
  pendingAction?: PendingAction
}

// The matter a row refers to: prefer the persisted task title from the result,
// fall back to the call args, then a short id, then the bulk-delete summary.
function matterLabel(call: AiToolCall): string {
  if (call.name === 'deleteAllTasks') return summarizeBulkDelete(call)
  // The step, not its parent. `addSubtask` and `toggleSubtask` return the whole
  // matter, so falling through to the title below named the wrong thing.
  const step = subtaskTextOf(call)
  if (step) return step
  const result = (call.result ?? {}) as Record<string, unknown>
  const task = result.task as Record<string, unknown> | undefined
  const title =
    (typeof task?.title === 'string' ? task.title : undefined) ??
    (typeof call.args.title === 'string' ? call.args.title : undefined)
  if (title) return title
  const taskId = typeof call.args.taskId === 'string' ? call.args.taskId : undefined
  if (taskId) return `#${taskId.slice(-6)}`
  return ''
}

// Bulk delete reads from a filter (domain/status) plus a count — either the
// pre-confirm live estimate (`args.count`) or the executed result
// (`result.deletedCount`).
function summarizeBulkDelete(call: AiToolCall): string {
  const args = call.args
  const result = (call.result ?? {}) as Record<string, unknown>
  const domain = typeof args.domain === 'string' ? args.domain : undefined
  const status = typeof args.status === 'string' ? args.status : undefined
  const executed = typeof result.deletedCount === 'number' ? result.deletedCount : undefined
  const estimate = typeof args.count === 'number' ? args.count : undefined
  const count = executed ?? estimate
  const scope = [status, domain].filter(Boolean).join(' ')
  const noun = count === 1 ? 'matter' : 'matters'
  if (count !== undefined) return scope ? `${count} ${scope} ${noun}` : `${count} ${noun}`
  return scope ? `all ${scope} matters` : 'all matters'
}

export function ToolCallCard({ call, onConfirm, onDecline, pendingAction = null }: ToolCallCardProps) {
  // Read unconditionally, before any branch returns — the verb names the action
  // in every shape below, and hooks cannot hide behind an early return.
  const tChat = useTranslations('chat')

  // The only surviving confirmation: the irreversible bulk wipe.
  if (call.status === 'pending_confirmation') {
    const isConfirming = pendingAction === 'confirm'
    const isDeclining = pendingAction === 'decline'
    const isBusy = isConfirming || isDeclining
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 inline-block h-4 w-1 shrink-0 rounded-pill bg-accent" aria-hidden />
          <div>
            <p className="text-body-sm font-semibold text-ink">Clear matters</p>
            <p className="mt-0.5 text-caption text-ink-muted">{summarizeBulkDelete(call)}</p>
            <p className="mt-0.5 text-caption text-danger">This cannot be undone.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={isBusy && !isDeclining}
            onClick={() => onDecline(call.callId)}
          >
            {isDeclining ? 'Declining…' : 'Decline'}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            disabled={isBusy && !isConfirming}
            onClick={() => onConfirm(call.callId)}
          >
            {isConfirming ? 'Confirming…' : 'Confirm'}
          </Button>
        </div>
      </div>
    )
  }

  // There was a "Not saved" branch here, for the days when updateTask refused to
  // move a matter onto another one and returned `status: 'awaiting_confirmation'`
  // instead of writing. The contract is save-first now — the write always lands
  // and the clash comes back beside it — so nothing produces that status, and the
  // branch only ever rendered out of old transcripts.
  //
  // It is gone rather than kept as a safety net, because it was checked BEFORE
  // the saved-onto-a-clash card below and offered no way out: a warning with no
  // reschedule, no free times and no keep. A dead branch that outranks the live
  // one is a trap, not a fallback. An old transcript now renders its clash
  // through the same card as everything else.

  // failed / declined — a muted ledger row.
  if (call.status === 'failed' || call.status === 'declined') {
    return (
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <X size={13} strokeWidth={2.5} className="shrink-0 text-ink-subtle" />
        <span className="truncate text-caption text-ink-muted" dir="auto">
          {call.status === 'declined' ? 'Declined' : (call.error ?? 'Action failed')}
        </span>
      </div>
    )
  }

  // A DRAFT, not a receipt: a proposal that saved nothing, confirmed through
  // /api/planning/commit exactly like the voice capture flow.
  //
  // Gated on there being NO persisted task, which is the whole difference
  // between the two. createTask files immediately again, so a result carrying a
  // real task is a receipt — the draft branch reading `draft` alone would put a
  // "Not saved yet" proposal card over a matter that is already in the list.
  // The branch itself stays: history rows written while createTask pointed at
  // /me/tasks/draft still render out of the transcript.
  const result = (call.result ?? {}) as {
    draft?: unknown
    task?: { id?: string; title?: string; dueAt?: string | null }
    conflicts?: unknown[]
    suggestions?: string[]
    suggestionReason?: string
  }
  if (result.draft && !result.task) return <DraftConfirm draft={result.draft as never} />

  // Saved onto a clash: the write went through — save-first is the contract —
  // and this card is the decision that follows it: move to a verified-free
  // time, type another, or keep the overlap. Checked before the receipt branch,
  // which would otherwise render this as an ordinary success.
  if (result.task?.id && result.conflicts?.length) {
    return (
      <SavedConflictCard
        taskId={result.task.id}
        title={result.task.title ?? ''}
        dueAt={result.task.dueAt ?? null}
        conflicts={result.conflicts as never}
        suggestions={result.suggestions ?? []}
        suggestionReason={result.suggestionReason ?? ''}
      />
    )
  }

  const verb = tChat(`ledger.verb.${ledgerVerbOf(call)}`)
  // A read names what it matched, not a matter it did not touch: `queryTasks`
  // carries no title, so the row used to render a bare verb and no object.
  const matches = queryMatchCount(call)
  const matter = matches === null ? matterLabel(call) : tChat('ledger.matched', { count: matches })
  const fields = taskFieldsOf(call)

  // A matter was filed, with guesses attached — the card.
  if (fields) return <FiledReceipt verb={verb} matter={matter} fields={fields} />

  // Nothing to correct — the quiet ledger row: purple tick · verb · matter.
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />
      <span className="shrink-0 text-caption font-medium text-ink">{verb}</span>
      {matter ? (
        <span className="truncate text-caption text-ink-muted" dir="auto">
          {matter}
        </span>
      ) : null}
    </div>
  )
}

/**
 * The receipt for a matter that was filed.
 *
 * A card, not a ledger row: `createTask` / `updateTask` / `snoozeTask` put a
 * matter in the list with three values Kitto guessed on the user's behalf, and
 * a caption-weight line rendered them at the same emphasis as everything else —
 * the eye skips the row, the wrong guess ships. The facts themselves come from
 * `MatterFacts`, shared with the clarification card so a filed matter reads the
 * same whether or not there is a question attached to it.
 */
function FiledReceipt({
  verb,
  matter,
  fields,
}: {
  verb: string
  matter: string
  fields: ToolCallTaskFields
}) {
  return (
    <div className="rounded-2xl bg-surface p-3.5 shadow-card">
      <MatterFacts eyebrow={verb} title={matter} fields={fields} />
    </div>
  )
}
