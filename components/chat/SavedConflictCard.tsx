'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { SuggestedSlots } from '@/components/planning/SuggestedSlots'
import { WhenField } from '@/components/planning/WhenField'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { toast } from '@/lib/toast'
import { previewConflicts, type DraftConflict } from '@/queries/planning'
import { useUpdateTask, type Task } from '@/queries/tasks'
import { api } from '@/lib/api/client'

const CONFLICT_KEPT_KEY = 'kitto:conflict_kept'

function getKeptConflicts(): string[] {
  try {
    const raw = window.localStorage.getItem(CONFLICT_KEPT_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveKeptConflict(taskId: string) {
  try {
    const current = getKeptConflicts()
    if (!current.includes(taskId)) {
      window.localStorage.setItem(CONFLICT_KEPT_KEY, JSON.stringify([...current, taskId]))
    }
  } catch {}
}

/**
 * A matter chat SAVED onto a clash — and the way out of it.
 *
 * The old shape refused the save and negotiated ("NOT SAVED … awaiting
 * confirmation"), which put the user's own request behind a gate and, worse,
 * left the agent to resolve the clash on its own judgement. Now the write is
 * already real when this renders: the card's job is only the DECISION — move it
 * to a verified-free time (one tap), type any other time, or keep it where it
 * is. Keeping costs nothing because nothing is pending.
 *
 * Retiming goes through the same PATCH every other surface uses, and every
 * retime re-checks live — so the clash lines clear in front of the user when
 * the new time is free, which is the only confirmation that means anything.
 *
 * History self-heals: a card replayed from an old transcript re-checks on
 * mount, so a clash resolved elsewhere renders as resolved rather than
 * re-raising a decision the user already made.
 */
export function SavedConflictCard({
  taskId,
  title,
  dueAt,
  conflicts: initialConflicts,
  suggestions: initialSuggestions,
  suggestionReason: initialReason,
}: {
  taskId: string
  title: string
  dueAt: string | null
  conflicts: DraftConflict[]
  suggestions: string[]
  suggestionReason: string
}) {
  const update = useUpdateTask()
  const tag = useIntlTag()

  const [at, setAt] = useState<Date | null>(dueAt ? new Date(dueAt) : null)
  const [stagedDate, setStagedDate] = useState<Date | null>(dueAt ? new Date(dueAt) : null)
  const [conflicts, setConflicts] = useState<DraftConflict[]>(initialConflicts)
  const [slots, setSlots] = useState<{ at: string[]; why: string }>({
    at: initialSuggestions,
    why: initialReason,
  })
  const [kept, setKept] = useState(() => getKeptConflicts().includes(taskId))
  const [checking, setChecking] = useState(false)
  const [checkingLive, setCheckingLive] = useState(() => !getKeptConflicts().includes(taskId))
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Mount-time re-check, once. The tool result this card renders from is a
  // snapshot; the calendar is not. Skipped for the just-streamed case only in
  // effect ordering, not in kind — a fresh card re-checking is merely cheap.
  const checkedOnMount = useRef(false)
  useEffect(() => {
    if (checkedOnMount.current) return
    checkedOnMount.current = true
    
    api<{ task: Task }>(`/me/tasks/${taskId}`)
      .then((res) => {
        const liveTask = res.task
        if (liveTask.status === 'done') {
          setConflicts([])
          return
        }
        const liveDue = liveTask.dueAt ? new Date(liveTask.dueAt) : null
        setAt(liveDue)
        setStagedDate(liveDue)
        return previewConflicts(taskId, { dueAt: liveTask.dueAt ?? null })
      })
      .then((found) => {
        if (!found) return
        setConflicts(found.conflicts)
        setSlots({ at: found.suggestions, why: found.suggestionReason })
      })
      .catch(() => {
        setConflicts([])
      })
      .finally(() => {
        setCheckingLive(false)
      })
  }, [taskId])

  const retime = (next: Date) => {
    setChecking(true)
    update.mutate(
      { taskId, body: { dueAt: next.toISOString() } },
      {
        onSuccess: () => {
          setAt(next)
          setStagedDate(next)
          void previewConflicts(taskId, { dueAt: next.toISOString() })
            .then((found) => {
              setConflicts(found.conflicts)
              setSlots({ at: found.suggestions, why: found.suggestionReason })
            })
            .finally(() => setChecking(false))
        },
        onError: () => {
          setChecking(false)
          toast.error('Could not move that. Try again.')
        },
      },
    )
  }

  const when = at ? `${formatDayMonthMaybeYear(at, new Date(), tag)}, ${formatTime(at, tag)}` : null
  const resolved = conflicts.length === 0
  const isModified = stagedDate && at ? stagedDate.getTime() !== at.getTime() : stagedDate !== at

  if (checkingLive) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card animate-pulse">
        <div className="min-w-0">
          <p className="truncate text-body-sm font-semibold text-ink-muted">{title}</p>
          <p className="mt-0.5 text-caption text-ink-subtle">Checking clash status…</p>
        </div>
      </div>
    )
  }

  // Settled — kept deliberately, or moved until nothing overlaps.
  if (kept || resolved) {
    return (
      <div className="flex items-center gap-2.5 px-1 py-1.5">
        <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />
        <span className="shrink-0 text-caption font-medium text-ink">
          {kept ? 'Kept' : 'No clashes'}
        </span>
        <span className="truncate text-caption text-ink-muted" dir="auto">
          {title}
          {when ? ` — ${when}` : ''}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card">
      <div className="min-w-0">
        <p className="truncate text-body-sm font-semibold text-ink" dir="auto">
          {title}
        </p>
        {/* Saved is the headline fact: the matter exists, at this time, right
            now — everything below is about whether it should stay there. */}
        <p className="mt-0.5 text-caption text-ink-muted">
          Saved{when ? ` for ${when}` : ''} — but it clashes.
        </p>
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
              const t2 = at ? at.getTime() : null
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
              const proposedTimeStr = at ? formatTime(at, tag) : ''

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
                        <span className="truncate">{title} ({proposedTimeStr})</span>
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

      <SuggestedSlots slots={slots.at} reason={slots.why} onPick={retime} />

      {showDatePicker && <WhenField value={stagedDate} unanswered={false} onPick={setStagedDate} />}

      <div className="flex gap-2">
        {isModified ? (
          <>
            <button
              onClick={() => {
                if (stagedDate) retime(stagedDate)
              }}
              disabled={checking || update.isPending}
              className="flex-1 rounded-pill bg-solid px-4 py-2 text-body-sm font-medium text-solid-ink disabled:opacity-50"
            >
              Confirm new time
            </button>
            <button
              onClick={() => {
                setStagedDate(at)
                setShowDatePicker(false)
              }}
              disabled={checking || update.isPending}
              className="flex-1 rounded-pill bg-surface-field px-4 py-2 text-body-sm text-ink-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setShowDatePicker(prev => !prev)}
              disabled={checking || update.isPending}
              className="flex-1 rounded-pill bg-solid px-4 py-2 text-body-sm font-medium text-solid-ink disabled:opacity-50"
            >
              Reschedule
            </button>
            <button
              onClick={() => {
                setKept(true)
                saveKeptConflict(taskId)
              }}
              disabled={checking || update.isPending}
              className="flex-1 rounded-pill bg-surface-field px-4 py-2 text-body-sm text-ink-muted disabled:opacity-50"
            >
              Keep it anyway
            </button>
          </>
        )}
      </div>
    </div>
  )
}
