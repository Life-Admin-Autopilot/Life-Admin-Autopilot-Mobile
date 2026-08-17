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

/**
 * An option chip's label with any 24-hour time the model wrote ("Afternoon
 * (14:00)") re-rendered in the locale's own clock from the option's dueAt —
 * "Afternoon (2:00 PM)" in English. The model authors labels on a 24-hour
 * clock; the user's clock is a display concern, so it is settled here, not in
 * the prompt. Labels without a recognizable time, or options without a
 * parseable dueAt, pass through untouched.
 */
export function timeChipLabel(label: string, dueAt: string | undefined, tag: string): string {
  if (!dueAt) return label
  const instant = new Date(dueAt)
  if (Number.isNaN(instant.getTime())) return label
  const pattern = /\b([01]?\d|2[0-3]):[0-5]\d\b/
  if (!pattern.test(label)) return label
  return label.replace(pattern, formatTime(instant, tag))
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

// ---------------------------------------------------------------------------
// Elapsed / remaining time.
//
// Three surfaces used to phrase this themselves, in three different English
// dialects: DeadlineMeter said "in 4h" and "17d late", NotificationBell said
// "17d ago", scanTime said "Yesterday". Every one of them concatenated an
// English suffix onto a number, which is untranslatable by construction — and
// none of them agreed on where the hour/day boundary sat.
//
// The fix is not a better set of strings, it is not owning the strings at all:
// `Intl.RelativeTimeFormat` already knows "in 2 hours", "غدًا", "قبل ساعتين",
// and `Intl.NumberFormat`'s unit style already knows "2 hours" / "ساعتان" —
// including Arabic's dual, which no hand-written `n === 1 ? …` can reach. What
// is genuinely ours is the *ladder*: the decision to call 90 minutes "2 hours"
// rather than "90 minutes". That decision lives once, in `timeDelta`.

/**
 * The units both `Intl.RelativeTimeFormat` and `Intl.NumberFormat`'s unit style
 * accept. `week` is in the type but never chosen by the ladder below — a caller
 * that genuinely means weeks can still pass it to `formatRelativeValue`.
 */
export type TimeUnit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface TimeDelta {
  /** Signed: negative is in the past, positive is in the future. */
  value: number
  unit: TimeUnit
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
/** Approximations, deliberately: a month has no fixed length and CLDR agrees. */
const MONTH_MS = 30.44 * DAY_MS
const YEAR_MS = 365.25 * DAY_MS

/**
 * The one unit ladder in the app. Rounds first and *then* compares, so 59.6
 * minutes reads "in 1 hour" rather than "in 60 minutes".
 *
 * Anything under a minute collapses to zero seconds — which
 * `Intl.RelativeTimeFormat` renders as "now" / "الآن" rather than a count.
 * Deliberate: the callers refresh on a 30-second timer, so a live second count
 * would be wrong roughly half the time it was on screen, and "in 43 seconds"
 * is noise on a deadline anyway.
 *
 * Days run all the way to a month rather than folding into weeks at seven.
 * A week rung is the conventional choice and it is the wrong one here: it turns
 * "in 10 days" into "next week", which is precisely the collapse of near-future
 * time that DeadlineMeter exists to undo. Ten days and thirteen days are
 * different amounts of runway and the phrase has to say so.
 */
export function timeDelta(ms: number): TimeDelta {
  if (Math.abs(ms) < MINUTE_MS) return { value: 0, unit: 'second' }

  const minutes = Math.round(ms / MINUTE_MS)
  if (Math.abs(minutes) < 60) return { value: minutes, unit: 'minute' }

  const hours = Math.round(ms / HOUR_MS)
  if (Math.abs(hours) < 24) return { value: hours, unit: 'hour' }

  const days = Math.round(ms / DAY_MS)
  if (Math.abs(days) < 30) return { value: days, unit: 'day' }

  const months = Math.round(ms / MONTH_MS)
  if (Math.abs(months) < 12) return { value: months, unit: 'month' }

  return { value: Math.round(ms / YEAR_MS), unit: 'year' }
}

const relativeCache = new Map<string, Intl.RelativeTimeFormat>()

// `numeric: 'auto'` is what buys the named forms — "tomorrow", "yesterday",
// "غدًا", "أول أمس" — instead of "in 1 day". Those read better than a count
// everywhere they appear, and in Arabic they are also the only forms with the
// correct oblique dual.
function relativeFormatter(tag: string): Intl.RelativeTimeFormat {
  const hit = relativeCache.get(tag)
  if (hit) return hit
  const made = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' })
  relativeCache.set(tag, made)
  return made
}

/**
 * "in 2 hours" / "خلال ساعتين" / "yesterday" / "الآن".
 *
 * Takes an already-decided value and unit, for the callers that compute their
 * own — scanTime counts *calendar* days, so that an 11pm scan is "Yesterday"
 * at 1am rather than "2 hours ago", and must not be re-laddered from elapsed ms.
 */
export function formatRelativeValue(value: number, unit: TimeUnit, tag: string): string {
  return relativeFormatter(tag).format(value, unit)
}

/** `timeDelta` + `formatRelativeValue`, for callers with a plain elapsed span. */
export function formatRelativeTime(ms: number, tag: string): string {
  const { value, unit } = timeDelta(ms)
  return formatRelativeValue(value, unit, tag)
}

const durationCache = new Map<string, Intl.NumberFormat>()

function durationFormatter(tag: string, unit: TimeUnit): Intl.NumberFormat {
  const key = `${tag}|${unit}`
  const hit = durationCache.get(key)
  if (hit) return hit
  const made = new Intl.NumberFormat(tag, { style: 'unit', unit, unitDisplay: 'long' })
  durationCache.set(key, made)
  return made
}

/**
 * A bare, direction-less span: "2 hours" / "ساعتان", "17 days" / "17 يومًا".
 *
 * For the sentences `Intl.RelativeTimeFormat` cannot phrase — an overdue
 * deadline is not "2 hours ago", it is "2 hours late", and only the app knows
 * that. Interpolate this into an ICU message rather than concatenating a
 * suffix: CLDR's unit patterns carry every plural category the language has,
 * Arabic's dual included, so nothing here needs a `plural` block of its own.
 */
export function formatDuration(ms: number, tag: string): string {
  const { value, unit } = timeDelta(ms)
  return durationFormatter(tag, unit).format(Math.abs(value))
}
