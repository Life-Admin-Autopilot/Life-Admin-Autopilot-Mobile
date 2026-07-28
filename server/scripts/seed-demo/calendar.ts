// Wall-clock date math in the persona's zone.
//
// Egypt reintroduced DST in 2023, mid-way through the window this seed covers,
// so a fixed +02:00 offset would silently misplace every summer matter by an
// hour — and matters near local midnight would land on the wrong DAY, which is
// what the /matters time buckets and the digest are built on. Everything here
// goes through Intl, which knows the real rules.

import { TIMEZONE } from './config'

export const DAY_MS = 86_400_000

interface Parts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** The persona's local wall clock at a given instant. */
export function partsAt(instant: Date): Parts {
  const found: Record<string, number> = {}
  for (const part of FORMATTER.formatToParts(instant)) {
    if (part.type !== 'literal') found[part.type] = Number(part.value)
  }
  return {
    year: found.year!,
    // Intl renders midnight as hour 24 in some engines; normalise to 0.
    month: found.month!,
    day: found.day!,
    hour: found.hour! % 24,
    minute: found.minute!,
    second: found.second!,
  }
}

/** How far the zone is ahead of UTC at a given instant, in ms. */
function offsetAt(instant: Date): number {
  const p = partsAt(instant)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - instant.getTime()
}

// The instant at which the persona's clock reads the given wall time.
//
// Two passes, not one: the offset has to be sampled at the answer, but the
// answer needs the offset. Guessing with UTC and correcting once lands within
// an hour of the truth, which is close enough that the second pass samples the
// correct side of any DST boundary.
export function cairo(
  year: number,
  month: number,
  day: number,
  hour = 9,
  minute = 0,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0)
  let instant = new Date(wall - offsetAt(new Date(wall)))
  instant = new Date(wall - offsetAt(instant))
  return instant
}

/** Local midnight of the day an instant falls on. */
export function startOfDay(instant: Date): Date {
  const p = partsAt(instant)
  return cairo(p.year, p.month, p.day, 0, 0)
}

/** Same local day, different local time. */
export function atTime(instant: Date, hour: number, minute = 0): Date {
  const p = partsAt(instant)
  return cairo(p.year, p.month, p.day, hour, minute)
}

/**
 * `n` local days later, preserving the wall-clock time of day. Adding raw
 * milliseconds would drift by an hour across a DST boundary.
 */
export function addDays(instant: Date, n: number): Date {
  const p = partsAt(instant)
  return cairo(p.year, p.month, p.day + n, p.hour, p.minute)
}

export function addMonths(instant: Date, n: number): Date {
  const p = partsAt(instant)
  return cairo(p.year, p.month + n, p.day, p.hour, p.minute)
}

/** Whole local days from `a` to `b`, positive when `b` is later. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

/** 'YYYY-MM-DD' in the persona's zone — the key the digest is stored under. */
export function localDateKey(instant: Date): string {
  const p = partsAt(instant)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** 0 = Sunday. Uses the local day, not the UTC one. */
export function weekdayOf(instant: Date): number {
  const p = partsAt(instant)
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()
}

export function isWeekend(instant: Date): boolean {
  // Egypt's weekend is Friday–Saturday.
  const d = weekdayOf(instant)
  return d === 5 || d === 6
}

/**
 * Clamp a day-of-month to a month that may be shorter. `cairo()` would happily
 * roll February 31st into March, which turns "rent, due the 31st" into a
 * matter that skips February every year.
 */
export function clampDayOfMonth(year: number, month: number, day: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Math.min(day, lastDay)
}
