'use client'

import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import type { AppConflict } from '@/queries/planning'

/**
 * Clashes, on the home screen.
 *
 * <b>It asks the account, not the day.</b> This block lived inside the briefing
 * card, which is scoped to today AND returns null when today has no matters on
 * it — so two matters clashing next week produced a dashboard that said nothing
 * while the chat card, the matter sheet and the notification feed all knew. A
 * clash is not a property of today; it earns its place on the strength of
 * existing.
 *
 * <b>It states, it does not resolve.</b> Two lines naming what collides, and a
 * way through to the rest. No free times, no keep button, no reschedule — those
 * belong to the sheet, where there is room to read them. A home screen that
 * offers a decision it has no space to explain is how a glance turns into a
 * chore.
 *
 * Tapping a line opens that matter; tapping the footer opens every clash.
 */

/**
 * How many lines earn a place here.
 *
 * Two. The count in the footer carries the rest, and the whole card is meant to
 * be read in a glance on the way past — a ledger of every collision is the
 * sheet's job.
 */
const MAX_ROWS = 2

export function ConflictsCard({
  conflicts,
  onOpenMatter,
  onOpenAll,
}: {
  conflicts: AppConflict[]
  onOpenMatter: (taskId: string) => void
  onOpenAll: (rect: DOMRect) => void
}) {
  const t = useTranslations('dashboard.conflicts')
  const tag = useIntlTag()

  if (conflicts.length === 0) return null

  const visible = conflicts.slice(0, MAX_ROWS)
  const now = new Date()

  const when = (iso: string | null): string =>
    iso
      ? `${formatDayMonthMaybeYear(new Date(iso), now, tag)}, ${formatTime(new Date(iso), tag)}`
      : t('undated')

  return (
    <section className="rounded-3xl bg-warning/10 p-4">
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={14} className="shrink-0 text-warning" />
        <h2 className="text-label uppercase tracking-wide text-warning">
          {t('cardTitle', { count: conflicts.length })}
        </h2>
      </div>

      <ul className="mt-2.5 flex flex-col gap-2">
        {visible.map((conflict) => (
          <li key={`${conflict.a.taskId}:${conflict.b.taskId}`}>
            {/* The whole line is the target, and it opens the side the urgency
                rule says should move — the same side the sheet would offer. */}
            <button
              type="button"
              onClick={() => onOpenMatter(conflict.yieldsTaskId)}
              className="flex w-full items-start gap-1.5 text-start"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-body-sm text-ink" dir="auto">
                  {conflict.a.title}
                </span>
                <span className="truncate text-caption text-ink-muted" dir="auto">
                  {t('clashesWith')} {conflict.b.title} · {when(conflict.b.dueAt)}
                </span>
              </span>
              <ChevronRight size={16} className="mt-0.5 shrink-0 text-ink-subtle rtl:rotate-180" />
            </button>
          </li>
        ))}
      </ul>

      {/* Always offered, not only on overflow: with exactly two clashes the
          sheet is still where they get resolved, and a card whose way through
          appears and disappears by count is one the user cannot learn. */}
      <button
        type="button"
        onClick={(e) => onOpenAll(e.currentTarget.getBoundingClientRect())}
        className="mt-3 text-body-sm font-medium text-ink underline-offset-2 hover:underline"
      >
        {t('viewAll', { count: conflicts.length })}
      </button>
    </section>
  )
}
