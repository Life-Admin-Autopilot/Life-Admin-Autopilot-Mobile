// The one place `Intl.DateTimeFormat` is constructed.
//
// Everything routes through here for two reasons. First, correctness: callers
// used to pass `undefined` as the locale, which resolves to the *browser's*
// language — so an Arabic user on an English phone got Arabic chrome wrapped
// around English weekday names. The locale must come from the app, not the
// device. Second, cost: `new Intl.DateTimeFormat(...)` is one of the most
// expensive constructors in the platform, and formatDue runs once per row on
// every list render. These are cached.
//
// Pure (AGENTS.md → module boundaries): no store reads, no I/O. Callers pass
// the Intl tag, which components get from `useIntlTag()`.

type DateStyleOptions = Intl.DateTimeFormatOptions

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(tag: string, options: DateStyleOptions): Intl.DateTimeFormat {
  const key = `${tag}|${JSON.stringify(options)}`
  const hit = cache.get(key)
  if (hit) return hit
  const made = new Intl.DateTimeFormat(tag, options)
  cache.set(key, made)
  return made
}

/** "9:00 AM" / "9:00 ص" — digits stay Western in Arabic (see LOCALE_META). */
export function formatTime(date: Date, tag: string): string {
  return formatter(tag, { hour: 'numeric', minute: '2-digit' }).format(date)
}

/** "Monday" / "الاثنين" */
export function formatWeekday(date: Date, tag: string, style: 'long' | 'short' = 'long'): string {
  return formatter(tag, { weekday: style }).format(date)
}

/** "12 Mar" / "١٢ مارس" → with -u-nu-latn: "12 مارس" */
export function formatDayMonth(date: Date, tag: string): string {
  return formatter(tag, { month: 'short', day: 'numeric' }).format(date)
}

/** "12 Mar 2026" — the unambiguous form used in destructive confirmations. */
export function formatFullDate(date: Date, tag: string): string {
  return formatter(tag, { year: 'numeric', month: 'short', day: 'numeric' }).format(date)
}

/** "3/12" — the compact numeric form used in scan history. */
export function formatNumericDate(date: Date, tag: string, withYear = false): string {
  return formatter(tag, {
    month: 'numeric',
    day: 'numeric',
    ...(withYear ? { year: '2-digit' } : {}),
  }).format(date)
}

/**
 * "12 Mar" and, when the date falls outside `reference`'s year, "12 Mar 2027".
 * The year is dropped inside the current year because a due list that repeats
 * "2026" on every row is noise.
 */
export function formatDayMonthMaybeYear(date: Date, reference: Date, tag: string): string {
  const sameYear = date.getFullYear() === reference.getFullYear()
  return formatter(tag, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date)
}

/** The IANA zone the device is in. Not a formatting concern, but the same seam. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
