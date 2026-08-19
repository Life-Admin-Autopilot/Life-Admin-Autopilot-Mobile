'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'

import { SuggestedSlots } from '@/components/planning/SuggestedSlots'
import { WhenField } from '@/components/planning/WhenField'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { toast } from '@/lib/toast'
import { previewConflicts, type DraftConflict } from '@/queries/planning'
import { useUpdateTask } from '@/queries/tasks'

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
  const [conflicts, setConflicts] = useState<DraftConflict[]>(initialConflicts)
  const [slots, setSlots] = useState<{ at: string[]; why: string }>({
    at: initialSuggestions,
    why: initialReason,
  })
  const [kept, setKept] = useState(false)
  const [checking, setChecking] = useState(false)

  // Mount-time re-check, once. The tool result this card renders from is a
  // snapshot; the calendar is not. Skipped for the just-streamed case only in
  // effect ordering, not in kind — a fresh card re-checking is merely cheap.
  const checkedOnMount = useRef(false)
  useEffect(() => {
    if (checkedOnMount.current) return
    checkedOnMount.current = true
    void previewConflicts(taskId, { dueAt: at?.toISOString() ?? null }).then((found) => {
      setConflicts(found.conflicts)
      setSlots({ at: found.suggestions, why: found.suggestionReason })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retime = (next: Date) => {
    setChecking(true)
    update.mutate(
      { taskId, body: { dueAt: next.toISOString() } },
      {
        onSuccess: () => {
          setAt(next)
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

      <ul className="flex flex-col gap-1">
        {conflicts.map((conflict) => (
          <li key={conflict.taskId} className="flex items-start gap-1.5 text-caption text-warning">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span dir="auto">
              {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
            </span>
          </li>
        ))}
      </ul>

      <SuggestedSlots slots={slots.at} reason={slots.why} onPick={retime} />

      {/* Any other time they'd rather have — each pick re-saves and re-checks. */}
      <WhenField value={at} unanswered={false} onPick={retime} />

      <div className="flex items-center gap-2">
        <button
          onClick={() => setKept(true)}
          disabled={checking || update.isPending}
          className="flex-1 rounded-pill bg-warning px-4 py-2 text-body-sm font-medium text-accent-ink disabled:opacity-50"
        >
          Keep it anyway
        </button>
        {checking || update.isPending ? (
          <Loader2 size={16} className="shrink-0 animate-spin text-ink-subtle" />
        ) : null}
      </div>
    </div>
  )
}
