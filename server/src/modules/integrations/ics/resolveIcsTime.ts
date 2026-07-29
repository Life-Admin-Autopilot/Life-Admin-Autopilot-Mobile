// Turn an ICS DTSTART into a firing instant, honestly.
//
// This module exists because `ICAL.Time#toJSDate()` cannot be trusted for feed
// data, and the way it fails is silent. Given:
//
//     DTSTART;TZID=Europe/London:20260903T090000
//
// in a feed that carries no VTIMEZONE block — which is extremely common, because
// publishers assume the consumer knows what Europe/London means — ical.js finds
// no registered zone, falls back to "floating", and toJSDate() then resolves the
// wall clock against the SERVER's local timezone. On a UTC box that is a one-hour
// error; on a machine set to UTC-4 it is five. Nothing in the return value says
// so. The event just lands at the wrong time forever.
//
// So we never call toJSDate(). We read the raw wall-clock components and the
// TZID *parameter* (which survives even when the zone itself is unresolvable),
// classify which of four cases we are in, and hand off to the tested converter
// in ../dateOnly.ts.
//
// The classification is split out from the resolution (classifyIcsZone /
// resolveWallClock) because recurrence expansion needs both halves separately:
// an RRULE occurrence inherits its master's zone, but each occurrence must be
// converted on its own. Converting once and adding seven days repeatedly would
// drift by an hour the moment a series crosses a DST boundary — which a weekly
// school event does twice a year.

import type ICAL from 'ical.js'
import {
  type ResolvedDueAt,
  isValidTimeZone,
  resolveDateOnly,
  zonedWallClockToUtc,
} from '../dateOnly'

export interface IcsTimeContext {
  /** The user's IANA zone. Required — floating and all-day both need it. */
  timezone: string
  /** The user's 'HH:mm' import default, for all-day events. */
  defaultTimeOfDay?: string
}

export interface IcsTimeResolution extends ResolvedDueAt {
  /**
   * The original DTSTART line, verbatim. Rendered in the source viewer behind
   * the CitationChip — for a low-confidence floating time the raw line IS the
   * evidence, and paraphrasing it would defeat the point.
   */
  rawLine: string
}

/** The wall-clock components as the feed wrote them, before any conversion. */
export interface WallClock {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
}

/**
 * What the feed said about this time's zone.
 *
 * `floating` carries `declaredTzid` when the feed named a zone we could not
 * resolve — an Outlook feed emitting `TZID="GMT Standard Time"`, which is a
 * Windows identifier rather than an IANA one. We keep the name so the user can
 * be told what was intended, even though we cannot honour it.
 */
export type IcsZoneSpec =
  | { kind: 'date' }
  | { kind: 'utc' }
  | { kind: 'zoned'; tzid: string }
  | { kind: 'floating'; declaredTzid?: string }

export function readWallClock(time: ICAL.Time): WallClock {
  return {
    year: time.year,
    month: time.month,
    day: time.day,
    hours: time.hour,
    minutes: time.minute,
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isoDate(wall: WallClock): string {
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`
}

/**
 * Decide which of the four cases a DTSTART property falls into.
 *
 * Reads the TZID *parameter* rather than `time.zone`, because ical.js reports
 * "floating" for any zone the feed did not also define as a VTIMEZONE — which
 * would collapse the `zoned` and `floating` cases together and lose the only
 * evidence that a zone was ever specified.
 */
export function classifyIcsZone(prop: ICAL.Property): IcsZoneSpec {
  const time = prop.getFirstValue() as ICAL.Time

  if (time.isDate) return { kind: 'date' }
  if (time.zone?.tzid === 'UTC') return { kind: 'utc' }

  const tzid = prop.getParameter('tzid')
  const zoneName = typeof tzid === 'string' ? tzid : undefined
  if (zoneName && isValidTimeZone(zoneName)) return { kind: 'zoned', tzid: zoneName }

  return zoneName ? { kind: 'floating', declaredTzid: zoneName } : { kind: 'floating' }
}

/**
 * Resolve one wall clock under a known zone spec.
 *
 * Safe to call per-occurrence during recurrence expansion: every call converts
 * independently, so a series crossing a DST boundary lands correctly on both
 * sides of it.
 */
export function resolveWallClock(
  wall: WallClock,
  spec: IcsZoneSpec,
  ctx: IcsTimeContext,
  rawLine: string,
): IcsTimeResolution {
  // All-day. The feed stated a date and nothing else, so this is the same
  // situation as a Google Task — apply the user's own default time.
  if (spec.kind === 'date') {
    return {
      ...resolveDateOnly({
        date: isoDate(wall),
        timezone: ctx.timezone,
        defaultTimeOfDay: ctx.defaultTimeOfDay,
      }),
      rawLine,
    }
  }

  // Explicit UTC (a trailing Z). The components already ARE UTC, so there is
  // nothing to convert and no ambiguity to flag.
  if (spec.kind === 'utc') {
    return {
      dueAt: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hours, wall.minutes)),
      precision: 'exact',
      confidence: 'high',
      note: 'time from source (UTC)',
      needsConfirmation: false,
      rawLine,
    }
  }

  // A TZID we can actually resolve.
  if (spec.kind === 'zoned') {
    return {
      dueAt: zonedWallClockToUtc(
        wall.year,
        wall.month,
        wall.day,
        wall.hours,
        wall.minutes,
        spec.tzid,
      ),
      precision: 'exact',
      confidence: 'high',
      note: `time from source (${spec.tzid})`,
      needsConfirmation: false,
      rawLine,
    }
  }

  // Floating, or a TZID we could not resolve. RFC 5545 says a floating time
  // means "whatever the observer's clock says", so the user's zone is the
  // specified reading — but publishers routinely mean a specific zone and omit
  // it, and a London school feed read by a Dubai parent moves the school run
  // four hours. Low confidence, ask before scheduling.
  if (!isValidTimeZone(ctx.timezone)) {
    // Mirrors dateOnly's refusal to guess: no device is present during a feed
    // poll, so there is nothing to fall back to. Delegating lets that module
    // own the single "we cannot proceed without a timezone" behaviour.
    return {
      ...resolveDateOnly({
        date: isoDate(wall),
        timezone: ctx.timezone,
        defaultTimeOfDay: ctx.defaultTimeOfDay,
      }),
      rawLine,
    }
  }

  return {
    dueAt: zonedWallClockToUtc(
      wall.year,
      wall.month,
      wall.day,
      wall.hours,
      wall.minutes,
      ctx.timezone,
    ),
    precision: 'floating',
    confidence: 'low',
    note: spec.declaredTzid
      ? `unrecognised timezone "${spec.declaredTzid}" — assumed yours`
      : 'no timezone in source — assumed yours',
    needsConfirmation: true,
    rawLine,
  }
}

/**
 * Resolve a DTSTART (or DTEND) property to an instant plus provenance.
 *
 * `prop` must be the ICAL.Property, not the ICAL.Time — the TZID lives on the
 * property's parameters, and it is the only surviving evidence of intent when
 * the zone itself could not be registered.
 */
export function resolveIcsTime(prop: ICAL.Property, ctx: IcsTimeContext): IcsTimeResolution {
  const time = prop.getFirstValue() as ICAL.Time
  return resolveWallClock(readWallClock(time), classifyIcsZone(prop), ctx, prop.toICALString())
}
