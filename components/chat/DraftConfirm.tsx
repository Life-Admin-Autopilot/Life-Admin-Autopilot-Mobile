'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'

import {
  conflictsFromError,
  previewDraftConflicts,
  useCommitDraft,
  type DraftConflict,
  type TaskDraft,
} from '@/queries/planning'
import { SuggestedSlots } from '@/components/planning/SuggestedSlots'
import { WhenField } from '@/components/planning/WhenField'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { toast } from '@/lib/toast'

/**
 * The chat agent's proposal, awaiting confirmation.
 *
 * The agent's createTask calls `/me/tasks/draft`, which saves nothing — so this
 * card is the moment a chat-created matter becomes real. It deliberately looks
 * like a proposal rather than a receipt: no tick, an explicit "not saved yet"
 * line, and the same conflict warnings the voice review shows.
 */
export function DraftConfirm({ draft: proposed }: { draft: TaskDraft }) {
  const commit = useCommitDraft()
  const tag = useIntlTag()
  const [state, setState] = useState<'open' | 'saved' | 'dismissed'>('open')

  // Clashes the SERVER refused on, which the agent's proposal did not carry.
  const [lateConflicts, setLateConflicts] = useState<DraftConflict[] | null>(null)
  // The user's own retiming, staged locally. Chat used to be the one capture
  // surface with no way to fix a time: the agent proposed, and the only answers
  // were Confirm or Dismiss — so correcting an hour meant dismissing the card
  // and saying the whole thing again.
  const [edited, setEdited] = useState<TaskDraft | null>(null)
  const [slots, setSlots] = useState<{ at: string[]; why: string }>({ at: [], why: '' })

  const draft = edited ?? proposed
  const due = draft.dueDate ? new Date(draft.dueDate) : null
  const conflicts = lateConflicts ?? draft.conflicts ?? []
  const unanswered = !due || Boolean(draft.timeAssumed)

  const retime = (next: Date) => {
    const nextDraft: TaskDraft = {
      ...draft,
      dueDate: next.toISOString(),
      timeAssumed: false,
      kind: 'reminder',
    }
    setEdited(nextDraft)
    // The old verdict was about the old time; leaving it up would blame the new
    // choice for a clash it may not have.
    setLateConflicts([])
    setSlots({ at: [], why: '' })
    void previewDraftConflicts(nextDraft).then((preview) => {
      setLateConflicts(preview.conflicts)
      setSlots({ at: preview.suggestions, why: preview.suggestionReason })
    })
  }

  if (state === 'dismissed') {
    return (
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <X size={13} strokeWidth={2.5} className="shrink-0 text-ink-subtle" />
        <span className="truncate text-caption text-ink-muted">Draft dismissed</span>
      </div>
    )
  }

  if (state === 'saved') {
    return (
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />
        <span className="shrink-0 text-caption font-medium text-ink">Filed</span>
        <span className="truncate text-caption text-ink-muted" dir="auto">
          {draft.title}
        </span>
      </div>
    )
  }

  const save = async () => {
    try {
      // Confirmation is asserted only for clashes already rendered below this
      // button. Passing it unconditionally would make the server's refusal a
      // formality and put us back where we started.
      await commit.mutateAsync({ draft, confirmConflicts: conflicts.length > 0 })
      setState('saved')
    } catch (err) {
      const refused = conflictsFromError(err)
      if (refused) {
        setLateConflicts(refused)
        toast.error('That clashes with something already scheduled.')
      } else {
        toast.error('Could not save that. Try again.')
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-block h-4 w-1 shrink-0 rounded-pill bg-accent" aria-hidden />
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-ink" dir="auto">
            {draft.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill>{draft.category}</Pill>
            {draft.priority !== 'normal' ? <Pill>{draft.priority}</Pill> : null}
            <Pill>
              {due
                ? `${formatDayMonthMaybeYear(due, new Date(), tag)}${
                    draft.kind === 'reminder' ? `, ${formatTime(due, tag)}` : ''
                  }`
                : 'no date'}
            </Pill>
            {/* The hour is Kitto's, not theirs — say so rather than letting the
                chip read like something they chose. */}
            {draft.timeAssumed && due ? <Pill>time assumed</Pill> : null}
          </div>
          <p className="mt-1.5 text-caption text-ink-muted">Not saved yet.</p>

          {/* Editable until it is saved — change the day, the hour, AM/PM, as
              often as you like. Every change re-checks the new slot. */}
          <WhenField value={due} unanswered={unanswered} onPick={retime} />
        </div>
      </div>

      {conflicts.length ? (
        <ul className="flex flex-col gap-1">
          {conflicts.map((conflict) => (
            <li key={conflict.taskId} className="flex items-start gap-1.5 text-caption text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {conflicts.length ? (
        <SuggestedSlots slots={slots.at} reason={slots.why} onPick={retime} />
      ) : null}

      <div className="flex gap-2">
        <button
          onClick={() => setState('dismissed')}
          disabled={commit.isPending}
          className="flex-1 rounded-pill bg-surface-field px-4 py-2 text-body-sm text-ink-muted disabled:opacity-50"
        >
          Dismiss
        </button>
        <button
          onClick={() => void save()}
          disabled={commit.isPending}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-pill px-4 py-2 text-body-sm font-medium text-accent-ink disabled:opacity-50 ${
            conflicts.length ? 'bg-warning' : 'bg-accent'
          }`}
        >
          {commit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
          {conflicts.length ? 'Save anyway' : 'Confirm'}
        </button>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill bg-surface-field px-2 py-0.5 text-label text-ink-muted">
      {children}
    </span>
  )
}
