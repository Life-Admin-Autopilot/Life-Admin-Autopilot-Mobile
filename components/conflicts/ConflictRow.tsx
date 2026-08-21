'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { SuggestedSlots } from '@/components/planning/SuggestedSlots'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { toast } from '@/lib/toast'
import { previewConflicts, type AppConflict, type ConflictSide } from '@/queries/planning'
import { useUpdateTask } from '@/queries/tasks'

/**
 * One clash in the conflicts sheet: both matters, and the way out.
 *
 * <b>There is no "keep it", and that is the design.</b> A clash is not an alert
 * waiting to be cleared — it is a fact about two saved matters, the same way a
 * calendar shows two events on top of each other without ever offering to
 * dismiss the overlap. It stops being listed the moment it stops being true, so
 * the only action here is the one that actually changes something: move a time.
 *
 * That is also what makes this list trustworthy. A dismissable list has to
 * remember what was dismissed, on which device, and for how long — and every one
 * of those answers can disagree with the next screen. Nothing is remembered
 * here, so nothing can disagree.
 *
 * The row offers to move the LOWER-URGENCY side, which the server already
 * decided (`yieldsTaskId`) from priority, time remaining and domain. Choosing
 * here would be a second implementation of that rule, and the two would
 * eventually disagree.
 *
 * Free times load when the row is opened, not with the list: a sheet showing six
 * clashes would otherwise fire six suggestion requests before the user had
 * looked at any of them, and they would be stale by the time one was tapped.
 */
export function ConflictRow({
  conflict,
  onOpenMatter,
}: {
  conflict: AppConflict
  onOpenMatter: (taskId: string) => void
}) {
  const t = useTranslations('dashboard.conflicts')
  const tag = useIntlTag()
  const update = useUpdateTask()

  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<{ at: string[]; why: string } | null>(null)
  const [loading, setLoading] = useState(false)

  // The side the server says should give way, and the one it collides with.
  const mover = conflict.a.taskId === conflict.yieldsTaskId ? conflict.a : conflict.b
  const other = conflict.a.taskId === conflict.yieldsTaskId ? conflict.b : conflict.a

  const expand = () => {
    const next = !open
    setOpen(next)
    if (!next || slots) return

    // Sparse body: ask about the matter exactly as it stands. The endpoint
    // excludes the matter itself, so it cannot be offered a slot it occupies.
    setLoading(true)
    void previewConflicts(mover.taskId, {})
      .then((found) => setSlots({ at: found.suggestions, why: found.suggestionReason }))
      .finally(() => setLoading(false))
  }

  const retime = (next: Date) => {
    update.mutate(
      { taskId: mover.taskId, body: { dueAt: next.toISOString() } },
      {
        // No re-check and no local hiding: the slot was verified free against
        // the same pool this list was built from, and the mutation invalidates
        // the list. The row leaves because the clash is gone, which is the only
        // reason a row should ever leave.
        onSuccess: () => toast.success(t('moved')),
        onError: () => toast.error(t('moveFailed')),
      },
    )
  }

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-surface p-3.5 shadow-card">
      <button
        type="button"
        onClick={expand}
        aria-expanded={open}
        className="flex items-start gap-2.5 text-start"
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <MatterLine side={mover} tag={tag} emphasis />
          <span className="text-caption text-ink-muted">{t('clashesWith')}</span>
          <MatterLine side={other} tag={tag} />
        </span>
        <ChevronDown
          size={16}
          className={`mt-0.5 shrink-0 text-ink-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="flex flex-col gap-2 border-t border-hairline pt-2">
          {loading ? (
            <div className="h-7 w-40 animate-pulse rounded-pill bg-surface-field" />
          ) : (
            <SuggestedSlots slots={slots?.at ?? []} reason={slots?.why ?? ''} onPick={retime} />
          )}

          {/* Always offered, because the free times are a convenience and not
              every matter should move to one of them — some need a real edit. */}
          <button
            type="button"
            onClick={() => onOpenMatter(mover.taskId)}
            disabled={update.isPending}
            className="rounded-pill bg-surface-field px-3 py-1.5 text-caption font-medium text-ink disabled:opacity-50"
          >
            {t('openMatter')}
          </button>
        </div>
      ) : null}
    </li>
  )
}

/** One matter's name and time. `dir="auto"` because a title may be either script. */
function MatterLine({
  side,
  tag,
  emphasis = false,
}: {
  side: ConflictSide
  tag: string
  emphasis?: boolean
}) {
  const t = useTranslations('dashboard.conflicts')
  const at = side.dueAt ? new Date(side.dueAt) : null
  const when = at ? `${formatDayMonthMaybeYear(at, new Date(), tag)}, ${formatTime(at, tag)}` : null

  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={`truncate text-body-sm text-ink ${emphasis ? 'font-semibold' : ''}`}
        dir="auto"
      >
        {side.title}
      </span>
      <span className="truncate text-caption text-ink-subtle">{when ?? t('undated')}</span>
    </span>
  )
}
