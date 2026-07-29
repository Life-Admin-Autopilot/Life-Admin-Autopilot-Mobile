// The single policy for "an external source gave us a date but not a time."
//
// This is not a per-integration detail. Three of the four task sources we can
// import from drop the time of day, each in a different way:
//
//   - Google Tasks   `due` is date-only by documented design: "the time portion
//                    of the timestamp is discarded". Reading or writing a time
//                    is impossible, not merely unsupported.
//   - Microsoft To Do `dueDateTime` is truncated to midnight AND converted to
//                    UTC, so an Apr 15 task can arrive as 2026-04-14T22:00:00.
//                    Imported naively it fires on the WRONG DAY.
//   - Apple EKReminder date-only unless the user set hour/minute, and a due date
//                    creates no alarm at all without a separate EKAlarm.
//   - ICS feeds      may carry a real zone, or may be "floating" — a wall clock
//                    with no Z and no TZID, meaning "09:00 wherever you are".
//
// Task.ts invalidates a `kind: 'reminder'` without a dueAt, and reminderWorker
// fires at exactly that instant. So every one of the above has to be turned into
// a real UTC instant somewhere, and if that conversion is done ad hoc at four
// call sites we will get four different wrong answers.
//
// THE POLICY, in one line: we never invent a time. We either use the time the
// source gave us, or we apply a time the USER stated, and we say which in the
// provenance so the citation chip can show it.
//
// That distinction is the whole point. "09:00 because you told us to nudge
// imported reminders at 09:00" is a fact about the user. "09:00 because the
// model thought a dentist appointment sounds like a morning thing" is a guess
// rendered as a promise, and principles.md says one of those loses the user
// permanently.

import { type ConfidenceBucket, type TimePrecision } from '../../models/Task'
import { DEFAULT_IMPORT_TIME } from '../../models/User'

export { DEFAULT_IMPORT_TIME }
export type { TimePrecision }

// Matches 'HH:mm' on a 24-hour clock and nothing else. Deliberately strict: a
// malformed preference silently becoming midnight would fire reminders in the
// middle of the night, which is the kind of bug users do not report — they just
// turn notifications off.
const TIME_OF_DAY_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface ResolvedDueAt {
  /** The instant the reminder should fire. */
  dueAt: Date
  /** What the source actually specified. Drives the citation chip's wording. */
  precision: TimePrecision
  /**
   * Confidence in the RESULT, not in the source. `dateOnly` stays `high`
   * because nothing was guessed — the date is the source's and the time is the
   * user's. `floating` is `low` because the wall clock genuinely could belong to
   * any zone and picking one is a coin flip with a four-hour blast radius.
   */
  confidence: ConfidenceBucket
  /**
   * Human-readable provenance for the CitationChip. Never rendered without a
   * source label in front of it — see the callers.
   */
  note: string
  /**
   * True when the caller MUST ask the user rather than silently scheduling.
   * principles.md: below the confidence threshold, ask instead of guessing.
   */
  needsConfirmation: boolean
}

export class TimezoneRequiredError extends Error {
  constructor() {
    super('A date-only import cannot be resolved without the user timezone.')
    this.name = 'TimezoneRequiredError'
  }
}

/** Parse 'HH:mm' into components, falling back to the default on anything odd. */
export function parseTimeOfDay(value: string | undefined | null): {
  hours: number
  minutes: number
} {
  const match = TIME_OF_DAY_RE.exec((value ?? '').trim())
  if (!match) {
    const [dh, dm] = DEFAULT_IMPORT_TIME.split(':')
    return { hours: Number(dh), minutes: Number(dm) }
  }
  return { hours: Number(match[1]), minutes: Number(match[2]) }
}

// What wall-clock time does `instant` show in `timeZone`? Returned as the epoch
// ms that wall clock WOULD represent if it were UTC, which is the form the
// offset arithmetic below needs.
function wallClockAsUtcMs(instant: Date, timeZone: string): number {
  // hourCycle h23 rather than hour12:false — the latter can still emit "24" for
  // midnight in some ICU versions, which parses to an out-of-range hour and
  // silently shifts the result by a day.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type)
    return found ? Number(found.value) : 0
  }

  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

/**
 * Convert a LOCAL wall clock in `timeZone` to the real UTC instant.
 *
 * Two passes, not one. The offset we need is the offset *at the answer*, but we
 * can only measure the offset *at a guess* — and near a DST boundary those
 * differ, which is exactly where a one-pass version lands an hour out. The
 * second pass re-measures at the corrected instant and converges.
 *
 * Ambiguous local times (the hour that repeats when clocks go back) resolve to
 * the first occurrence; nonexistent ones (the hour that is skipped) roll
 * forward. Both are the conventional choices and neither can be "right" — which
 * is another reason the result carries provenance rather than pretending to
 * precision.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
): Date {
  const targetWallMs = Date.UTC(year, month - 1, day, hours, minutes, 0)

  let instant = new Date(targetWallMs)
  for (let pass = 0; pass < 2; pass += 1) {
    const observedWallMs = wallClockAsUtcMs(instant, timeZone)
    const drift = targetWallMs - observedWallMs
    if (drift === 0) break
    instant = new Date(instant.getTime() + drift)
  }
  return instant
}

/** Validate an IANA zone by asking Intl to use it. Cheap and authoritative. */
export function isValidTimeZone(timeZone: string | undefined | null): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}

export interface ResolveDateOnlyInput {
  /** Calendar date as the source stated it, 'YYYY-MM-DD'. No time component. */
  date: string
  /** The user's IANA zone. Required — see TimezoneRequiredError. */
  timezone: string
  /** The user's stated import time, 'HH:mm'. Falls back to DEFAULT_IMPORT_TIME. */
  defaultTimeOfDay?: string
}

/**
 * A source gave us a bare date. Apply the user's own default time in the user's
 * own zone.
 *
 * Throws rather than defaulting to UTC when the timezone is missing. That looks
 * unhelpful and is deliberate: User.timezone is optional because on-device work
 * can read the device clock, but an IMPORT runs with no device present. Guessing
 * UTC for a user in Cairo moves every imported reminder two hours and nothing in
 * the UI would ever reveal it. Callers must resolve the timezone first — the
 * import flow asks for it — or skip the item.
 */
export function resolveDateOnly(input: ResolveDateOnlyInput): ResolvedDueAt {
  if (!isValidTimeZone(input.timezone)) throw new TimezoneRequiredError()

  const [y, m, d] = input.date.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Unparseable date-only value: ${input.date}`)

  const { hours, minutes } = parseTimeOfDay(input.defaultTimeOfDay)
  const dueAt = zonedWallClockToUtc(y, m, d, hours, minutes, input.timezone)
  const hhmm = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`

  return {
    dueAt,
    precision: 'dateOnly',
    // Nothing was inferred. The date is the source's, the time is the user's.
    confidence: 'high',
    note: `date only — your ${hhmm} default`,
    needsConfirmation: false,
  }
}

export interface ResolveFloatingInput {
  /** Local date, 'YYYY-MM-DD'. */
  date: string
  /** Local wall clock the feed stated, 'HH:mm' — with no zone attached. */
  timeOfDay: string
  timezone: string
}

/**
 * An ICS feed gave us a wall clock with no zone — `DTSTART:20260903T090000`,
 * no trailing Z and no TZID. Per RFC 5545 that is a "floating" time and means
 * "09:00 wherever the observer happens to be".
 *
 * We resolve it in the user's zone because that is the specified reading, but we
 * mark it LOW confidence and demand confirmation, because the common real-world
 * case is a publisher who meant a specific zone and omitted it. A school in
 * London publishing a floating 09:00 to a parent living in Dubai silently moves
 * the school run four hours, and overview.md names expats as a target user.
 */
export function resolveFloating(input: ResolveFloatingInput): ResolvedDueAt {
  if (!isValidTimeZone(input.timezone)) throw new TimezoneRequiredError()

  const [y, m, d] = input.date.split('-').map(Number)
  if (!y || !m || !d) throw new Error(`Unparseable floating date: ${input.date}`)

  const { hours, minutes } = parseTimeOfDay(input.timeOfDay)
  const dueAt = zonedWallClockToUtc(y, m, d, hours, minutes, input.timezone)

  return {
    dueAt,
    precision: 'floating',
    confidence: 'low',
    note: 'no timezone in source — assumed yours',
    needsConfirmation: true,
  }
}

/**
 * The source gave a real instant with a real zone. Nothing to decide; we record
 * that fact so the citation can say so and the UI can distinguish it from the
 * two cases above.
 */
export function resolveExact(instant: Date): ResolvedDueAt {
  return {
    dueAt: instant,
    precision: 'exact',
    confidence: 'high',
    note: 'time from source',
    needsConfirmation: false,
  }
}
