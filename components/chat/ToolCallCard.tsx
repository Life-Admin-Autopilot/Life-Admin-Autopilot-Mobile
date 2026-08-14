// Renders one tool call below an assistant message.
//
// Since the agent acts directly on every per-item mutation, a tool call is
// almost always a passive RECEIPT of what the assistant did. Two shapes carry
// that, split on whether there is anything left to correct:
//
//   FILED (create / update / snooze / hold) — a real card. These verbs put a
//     matter in the list with three values Kitto GUESSED on the user's behalf:
//     when, how urgent, which part of your life. A ledger line rendered them at
//     caption weight next to everything else, which is the uniform-emphasis
//     failure — the eye skips the row, the wrong guess ships. The card gives the
//     matter the same emoji-chip-and-title shape it will have in the list, so
//     the receipt is recognisably the thing that was filed, and puts each guess
//     in its own pill: legible at a glance, one message away from a correction.
//
//   EVERYTHING ELSE (delete / resolve / query / subtasks) — the quiet ledger
//     row it always was. These leave no guess behind, so a card would be a box
//     around a fact nobody needs to check.
//
// The single interactive exception is the bulk `deleteAllTasks` wipe, which
// still pauses for a Confirm / Decline card because it is irreversible.
//
// Institutional voice: state the action, no chatter — the product noun is
// "matter". A completion is a status change, not an event.

import { AlertTriangle, BellOff, CalendarDays, Check, X } from 'lucide-react'
import { DraftConfirm } from '@/components/chat/DraftConfirm'
import { useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { Pill, type PillTone } from '@/components/ui/Pill'
import { taskFieldsOf, type ToolCallTaskFields } from '@/lib/ai/toolCallSummary'
import type { AiToolCall } from '@/lib/ai/types'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDue } from '@/lib/taskFormat'
import type { TaskPriority } from '@/queries/tasks'

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
/**
 * The clashing matters from a tool call that declined to write.
 *
 * Reads `status`/`conflicts` off the tool RESULT rather than inferring anything
 * from the call's own status, because "the server said no on purpose" and "the
 * call broke" are the same `failed` to everything upstream — the difference only
 * exists in the payload the tool sent back.
 */
function heldForConflicts(call: AiToolCall): { taskId: string; title: string; reason: string }[] | null {
  const result = call.result as
    | { status?: string; conflicts?: { taskId: string; title: string; reason: string }[] }
    | null
  if (result?.status !== 'awaiting_confirmation') return null
  return result.conflicts?.length ? result.conflicts : null
}

function matterLabel(call: AiToolCall): string {
  if (call.name === 'deleteAllTasks') return summarizeBulkDelete(call)
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

// Priority always earns a pill on the card — it is one of the three guesses the
// card exists to expose — but not the same pill. Rendering "Urgent" and
// "Normal" identically would put the level true of most matters at the weight of
// the one that isn't, so only the loud two take a coloured wash; the quiet two
// sit in `field`, the tone this app already uses for "a value that is set".
const PRIORITY_TONE: Record<TaskPriority, PillTone> = {
  urgent: 'high',
  high: 'medium',
  normal: 'field',
  low: 'low',
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

  // HELD BACK, not failed. `updateTask` refuses to move a matter onto another
  // one until the user has been told, and returns the clashing matters instead of
  // writing. That arrives as an unsuccessful tool result, so without this branch
  // it renders as "Action failed" — which is untrue twice over: nothing failed,
  // and the reason the user needs is thrown away. Checked BEFORE the failed row
  // for exactly that reason.
  const held = heldForConflicts(call)
  if (held) {
    return (
      <div className="flex flex-col gap-1.5 rounded-2xl bg-warning/10 p-3">
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={13} className="shrink-0 text-warning" />
          <span className="text-label uppercase tracking-wide text-warning">Not saved</span>
        </div>
        <ul className="flex flex-col gap-1">
          {held.map((conflict) => (
            <li key={conflict.taskId} className="text-caption text-ink" dir="auto">
              {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

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

  // A DRAFT, not a receipt. The chat agent's createTask now calls
  // /me/tasks/draft, which saves nothing — so this branch has to come before the
  // "filed" card, or the user is shown a receipt for a matter that only exists
  // as a proposal. Confirming routes through /api/planning/commit, exactly like
  // the voice capture flow.
  const draft = (call.result as { draft?: unknown } | null)?.draft
  if (draft) return <DraftConfirm draft={draft as never} />

  const verb = tChat(`ledger.verb.${call.name}`)
  const matter = matterLabel(call)
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
 * Deliberately echoes `MatterListRow` — same emoji chip, same title weight — so
 * the card in the conversation and the row in the list are recognisably the
 * same object. What the list row hides, this one states: every value here is a
 * real persisted field, so a follow-up message ("make it urgent", "that's car
 * not home") has something concrete to correct.
 *
 * The domain reads twice — as the chip and as a word — and that is deliberate:
 * the chip is how the matter is identified everywhere else in the app, the word
 * is what makes a wrong guess nameable in the next message.
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
  const tMatters = useTranslations('matters')
  const tDomain = useTranslations('domain')
  const tChat = useTranslations('chat')
  const tag = useIntlTag()

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface p-3.5 shadow-card">
      <DomainIcon domain={fields.domain} size={40} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* Eyebrow, not a heading: what happened is the smallest thing on the
            card because the matter is the thing being checked. `text-label`
            rather than a literal tracking value — globals.css zeroes its
            letter-spacing under Arabic, where spacing between letters breaks
            the cursive join. */}
        <span className="flex items-center gap-1.5 text-label uppercase text-ink-subtle">
          <Check size={12} strokeWidth={3} className="shrink-0 text-accent" />
          {verb}
        </span>

        {matter ? (
          // Two lines, not a truncation: "Check health insurance rene…" hides
          // the half of the title that says which renewal it is.
          <span className="line-clamp-2 text-heading-sm text-ink" dir="auto">
            {matter}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          <MetaPill icon={<CalendarDays size={12} strokeWidth={2.25} />}>
            <span className="tabular">{formatDue(fields.dueAt, { t: tMatters, tag })}</span>
          </MetaPill>
          <MetaPill tone={PRIORITY_TONE[fields.priority]}>
            {tMatters(`priority.${fields.priority}`)}
          </MetaPill>
          {/* The word only. The emoji is already the chip on the left at 40px;
              repeating it at 12px inside the pill added a second, murkier copy
              of the one thing on the card that was never ambiguous. */}
          <MetaPill>{tDomain(fields.domain)}</MetaPill>
          {/* A date that is present but will never fire — the held high-stakes
              case. Silence here would read the date pill as a promise Kitto has
              not made. */}
          {fields.dueAt && !fields.willRemind ? (
            <MetaPill tone="warning" icon={<BellOff size={12} strokeWidth={2.25} />}>
              {tChat('ledger.noReminder')}
            </MetaPill>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Pills at meta scale. Same compact override the matter list row uses, so the
// two surfaces read as one system rather than two sizes of the same component.
function MetaPill({
  tone = 'field',
  icon,
  children,
}: {
  tone?: PillTone
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Pill tone={tone} icon={icon} className="gap-1 px-2.5 py-0.5 text-micro">
      {children}
    </Pill>
  )
}
