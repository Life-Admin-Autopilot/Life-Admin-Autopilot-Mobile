// Renders one tool call below an assistant message.
//
// Since the agent now acts directly on every per-item mutation, a tool call is
// almost always a passive RECEIPT of what the King did — rendered as a quiet
// ledger row (crimson tick · verb · matter · date), not a card. The single
// exception is the bulk `deleteAllTasks` wipe, which still pauses for a
// Confirm / Decline card because it is irreversible.
//
// Institutional voice: state the action, no chatter — the product noun is
// "matter". A completion is a status change, not an event.

import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { AiToolCall, AiToolName } from '@/lib/ai/types'

type PendingAction = 'confirm' | 'decline' | null

interface ToolCallCardProps {
  call: AiToolCall
  onConfirm: (callId: string) => void
  onDecline: (callId: string) => void
  /** Which action the user just initiated on THIS call (null otherwise). */
  pendingAction?: PendingAction
}

// Past-tense verb for a completed action — the ledger reads as a record of what
// already happened, not a menu of what could happen.
const PAST_VERB: Record<AiToolName, string> = {
  createTask: 'Created',
  updateTask: 'Updated',
  completeTask: 'Resolved',
  deleteTask: 'Deleted',
  deleteAllTasks: 'Cleared',
  snoozeTask: 'Deferred',
  queryTasks: 'Reviewed',
  addSubtask: 'Step added',
  toggleSubtask: 'Step updated',
  removeSubtask: 'Step removed',
  holdForClarification: 'Held',
}

// The matter a row refers to: prefer the persisted task title from the result,
// fall back to the call args, then a short id, then the bulk-delete summary.
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

// Trailing meta — the due date, formatted "Jun 25". Pulled from the persisted
// result first so an updated/created reminder shows its real, normalized date.
function metaLabel(call: AiToolCall): string {
  const result = (call.result ?? {}) as Record<string, unknown>
  const task = result.task as Record<string, unknown> | undefined
  const due =
    (typeof task?.dueAt === 'string' ? task.dueAt : undefined) ??
    (typeof call.args.dueAt === 'string' ? call.args.dueAt : undefined)
  if (!due) return ''
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  // The only surviving confirmation: the irreversible bulk wipe.
  if (call.status === 'pending_confirmation') {
    const isConfirming = pendingAction === 'confirm'
    const isDeclining = pendingAction === 'decline'
    const isBusy = isConfirming || isDeclining
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3.5 shadow-card">
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

  // executed — the quiet ledger row: crimson tick · verb · matter · date.
  const verb = PAST_VERB[call.name] ?? call.name
  const matter = matterLabel(call)
  const meta = metaLabel(call)
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />
      <span className="shrink-0 text-caption font-medium text-ink">{verb}</span>
      {matter ? (
        <span className="truncate text-caption text-ink-muted" dir="auto">
          {matter}
        </span>
      ) : null}
      {meta ? (
        <span className="tabular ml-auto shrink-0 text-caption text-ink-subtle">{meta}</span>
      ) : null}
    </div>
  )
}
