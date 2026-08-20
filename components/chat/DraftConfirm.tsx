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
  const [lateConflicts, setLateConflicts] = useState<DraftConflict[] | null>(null)
  const [edited, setEdited] = useState<TaskDraft | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  // Seeded from the proposal itself: a draft that arrives clashing arrives with
  // its escape routes, so the chips render on FIRST paint rather than only after
  // the user has retimed once. Older drafts in history predate the field and
  // simply start empty, exactly as before.
  const [slots, setSlots] = useState<{ at: string[]; why: string }>({
    at: proposed.suggestions ?? [],
    why: proposed.suggestionReason ?? '',
  })

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
          {(showDatePicker || unanswered) && (
            <WhenField value={due} unanswered={unanswered} onPick={retime} />
          )}
        </div>
      </div>

      {conflicts.length ? (
        <div className="flex flex-col gap-2.5 rounded-xl bg-surface-field p-3">
          <p className="flex items-center gap-1.5 text-micro font-bold tracking-wider text-ink-muted uppercase">
            <AlertTriangle size={12} className="text-warning shrink-0" />
            Clash Detected
          </p>
          <div className="flex flex-col gap-3">
            {conflicts.map((conflict) => {
              const isDuplicate = conflict.kind === 'duplicate'
              
              const t1 = conflict.dueAt ? new Date(conflict.dueAt).getTime() : null
              const t2 = due ? due.getTime() : null
              let left1 = 15
              let left2 = 35
              let width1 = 50
              let width2 = 50
              if (t1 && t2) {
                const diff = t2 - t1
                if (diff > 0) {
                  left1 = 15
                  left2 = 35
                } else if (diff < 0) {
                  left1 = 35
                  left2 = 15
                } else {
                  left1 = 25
                  left2 = 25
                }
              }
              const conflictTimeStr = conflict.dueAt ? formatTime(new Date(conflict.dueAt), tag) : ''
              const proposedTimeStr = due ? formatTime(due, tag) : ''

              return (
                <div key={conflict.taskId} className="flex flex-col gap-2.5">
                  {isDuplicate ? (
                    <div className="flex items-start justify-between rounded-lg bg-surface p-2.5 shadow-sm border-l-2 border-warning">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-caption font-semibold text-ink-muted">
                          {conflict.title}
                        </p>
                        <p className="text-label text-ink-subtle mt-0.5">
                          Existing duplicate matter
                        </p>
                      </div>
                      <span className="shrink-0 rounded-pill bg-warning-soft px-1.5 py-0.5 text-micro font-medium text-warning-ink">
                        Duplicate
                      </span>
                    </div>
                  ) : (
                    <div className="relative h-16 w-full rounded-lg bg-surface border border-border/40 overflow-hidden">
                      <div className="absolute inset-0 flex justify-between px-4 pointer-events-none opacity-20">
                        <div className="w-px h-full bg-border" />
                        <div className="w-px h-full bg-border" />
                        <div className="w-px h-full bg-border" />
                        <div className="w-px h-full bg-border" />
                      </div>
                      <div 
                        className="absolute top-1.5 h-6 rounded bg-ink-subtle/10 border-l-2 border-ink-subtle px-1.5 flex items-center text-micro text-ink-muted truncate"
                        style={{ left: `${left1}%`, width: `${width1}%` }}
                      >
                        <span className="truncate">{conflict.title} ({conflictTimeStr})</span>
                      </div>
                      <div 
                        className="absolute bottom-1.5 h-6 rounded bg-accent/15 border-l-2 border-accent px-1.5 flex items-center text-micro text-accent font-semibold truncate"
                        style={{ left: `${left2}%`, width: `${width2}%` }}
                      >
                        <span className="truncate">{draft.title} ({proposedTimeStr})</span>
                      </div>
                    </div>
                  )}
                  <p className="px-0.5 text-caption leading-snug text-warning-ink">
                    {conflict.reason}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {conflicts.length ? (
        <SuggestedSlots slots={slots.at} reason={slots.why} onPick={retime} />
      ) : null}

      <div className="flex gap-2">
        {conflicts.length ? (
          <>
            <button
              onClick={() => setShowDatePicker(prev => !prev)}
              disabled={commit.isPending}
              className="flex-1 rounded-pill bg-solid px-4 py-2 text-body-sm font-medium text-solid-ink disabled:opacity-50"
            >
              Reschedule
            </button>
            <button
              onClick={() => void save()}
              disabled={commit.isPending}
              className="flex-1 rounded-pill bg-surface-field px-4 py-2 text-body-sm text-ink-muted disabled:opacity-50"
            >
              Save anyway
            </button>
          </>
        ) : (
          <>
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
              className="flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-accent px-4 py-2 text-body-sm font-medium text-accent-ink disabled:opacity-50"
            >
              {commit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />}
              Confirm
            </button>
          </>
        )}
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
