// The /documents list's right-hand time column.
//
// A list row has room for roughly eight characters here, so precision is spent
// where it is actually useful: within today the exact clock time matters
// ("did that scan just land?"), within the week the weekday is enough, and
// beyond that only the date is. This is the same ladder a mail or chat list
// uses, and users read it without a legend.
//
// Pure and calendar-day based (not elapsed hours): a scan from 11pm last night
// is "Yesterday" at 1am, never "2 hours ago".
//
// Shaped like formatDue in lib/taskFormat.ts, for the same two reasons: the one
// literal ("Yesterday") comes from the caller's translator, and every date part
// goes through lib/i18n/dateFormat.ts with an explicit Intl tag. The tag matters
// — `toLocaleDateString(undefined, …)` resolves to the DEVICE's language, so an
// Arabic user on an English phone got "Mon" inside an otherwise Arabic row.

import { formatNumericDate, formatTime, formatWeekday } from '@/lib/i18n/dateFormat'
import type { Translate } from '@/lib/i18n/translate'

const DAY_MS = 86_400_000

export type ScanTimeKey = 'scanTime.yesterday'

export interface ScanTimeContext {
  /** Scoped to the `lib` namespace. */
  t: Translate<ScanTimeKey>
  /** Intl tag — `ar-u-nu-latn`, not `ar`. From `useIntlTag()`. */
  tag: string
  now?: Date
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function formatScanTime(iso: string, ctx: ScanTimeContext): string {
  const { t, tag } = ctx
  const now = ctx.now ?? new Date()

  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const daysApart = Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY_MS)

  // A clock-skewed or client-future timestamp falls through to the date form
  // rather than rendering a nonsensical "in 3 days" in a scan history.
  if (daysApart === 0) return formatTime(then, tag)
  if (daysApart === 1) return t('scanTime.yesterday')
  if (daysApart > 1 && daysApart < 7) return formatWeekday(then, tag, 'short')
  return formatNumericDate(then, tag, then.getFullYear() !== now.getFullYear())
}
