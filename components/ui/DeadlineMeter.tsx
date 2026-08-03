'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import { formatDuration, formatRelativeValue, timeDelta } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'

// A deadline made SPATIAL.
//
// "Due in 4 hours" is a sentence you have to read, parse, and convert into a
// feeling. For a brain with poor time perception that conversion frequently
// does not happen — time collapses into "now" and "not now", and a deadline
// four hours out sits in the same bucket as one four weeks out. A bar that is
// visibly nearly empty does the conversion for you.
//
// The scale is deliberately NON-LINEAR. On a linear 7-day scale, everything due
// in the next day sits in the last 14% of the track and all urgency looks
// identical. Taking the square root stretches the near end, so "tomorrow" and
// "in two hours" are visibly different — which is exactly the distinction that
// matters and the one a flat scale destroys.

/** Anything further out than this reads as simply "later". */
const HORIZON_MS = 7 * 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** A minute is plenty for a deadline; a per-second tick would just burn battery. */
const TICK_MS = 30_000

export function DeadlineMeter({
  dueAt,
  className,
}: {
  /** ISO timestamp. Undated tasks render nothing — there is no deadline to show. */
  dueAt: string | undefined
  className?: string
}) {
  // Null until mounted: the server prerender has no meaningful "now", and
  // rendering one would both mismatch on hydration and briefly show a wrong bar.
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null

  const remaining = now === null ? HORIZON_MS : due - now
  const overdue = remaining <= 0

  const fraction = Math.sqrt(Math.max(0, Math.min(1, remaining / HORIZON_MS)))
  const urgent = !overdue && remaining < 24 * HOUR_MS

  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken', className)}
      role="presentation"
    >
      <div
        style={{ width: overdue ? '100%' : `${Math.max(fraction * 100, 3)}%` }}
        className={cn(
          'h-full rounded-pill transition-[width,background-color] duration-700 ease-out',
          // Overdue is coral, not red. Red is this app's destructive colour and
          // a backlog painted in it is the thing that makes people stop opening
          // the app at all. Coral means "live", which is what an overdue matter is.
          overdue || urgent ? 'bg-accent' : 'bg-ink-subtle',
        )}
      />
    </div>
  )
}

/**
 * "in 2 hours" / "tomorrow" / "خلال ساعتين" / "17 days late".
 *
 * Companion to the meter for the one place a number is genuinely wanted. Kept
 * separate so a row can take the bar without the sentence, or the reverse.
 *
 * Neither direction is phrased here. Upcoming goes straight to
 * `Intl.RelativeTimeFormat`, which already owns "in 2 hours", "غدًا" and the
 * Arabic dual in every language it ships. Overdue is the one thing it cannot
 * say: a missed deadline is not "2 hours ago" — that reads as when something
 * happened, not that it is still waiting — so the span is formatted bare and
 * dropped into one ICU message that supplies the word "late".
 *
 * This is a component, so it may hold the hooks the pure formatters cannot.
 */
export function TimeUntil({ dueAt, className }: { dueAt: string | undefined; className?: string }) {
  const t = useTranslations('ui')
  const tag = useIntlTag()
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  if (!dueAt || now === null) return null
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null

  const remaining = due - now
  const { value, unit } = timeDelta(remaining)

  // `value === 0` is anything inside the last minute, either side of the
  // deadline, and lands here as "now" rather than "0 minutes late".
  const phrase =
    value < 0
      ? t('deadline.late', { duration: formatDuration(remaining, tag) })
      : formatRelativeValue(value, unit, tag)

  return <span className={className}>{phrase}</span>
}
