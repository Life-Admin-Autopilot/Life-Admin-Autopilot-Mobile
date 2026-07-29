// Walk a parsed VCALENDAR and produce the occurrences Kitto would file.
//
// Feeds ship RRULEs, not instances — "every Tuesday during term" is one VEVENT,
// not forty. So expansion happens here, and three things about it are
// load-bearing:
//
//   1. Every occurrence is converted from its OWN wall clock. Converting the
//      first one and adding seven days repeatedly drifts by an hour the moment
//      the series crosses a DST boundary, which a weekly school event does twice
//      a year. resolveWallClock() is called per occurrence for that reason.
//
//   2. Expansion is hard-capped. An RRULE with no UNTIL and no COUNT is
//      unbounded and perfectly legal, so an unguarded iterator is an infinite
//      loop that a stranger's URL can trigger on our server.
//
//   3. RECURRENCE-ID overrides are honoured. A feed that moves one instance of a
//      series emits a second VEVENT with the same UID and a RECURRENCE-ID naming
//      the slot it replaces. Expanding the master blindly would emit both the
//      original slot and the override — two matters for one event.

import ICAL from 'ical.js'
import {
  type IcsTimeContext,
  type IcsTimeResolution,
  classifyIcsZone,
  readWallClock,
  resolveWallClock,
} from './resolveIcsTime'

export interface IcsOccurrence {
  /** The feed's UID for the underlying event. */
  uid: string
  /**
   * Stable identity for THIS occurrence, used as Task.externalId.
   *
   * Built from the occurrence's original wall clock rather than the resolved
   * UTC instant, so that a user changing their timezone re-files existing
   * matters instead of duplicating every one of them.
   */
  externalId: string
  summary: string
  description?: string
  location?: string
  when: IcsTimeResolution
  isRecurring: boolean
}

export interface ParseIcsContext extends IcsTimeContext {
  /** Ignore occurrences before this instant. */
  from: Date
  /** Ignore occurrences after this instant. */
  to: Date
}

/** Per-series ceiling. A daily event over a two-year window is ~730. */
const MAX_OCCURRENCES_PER_SERIES = 400
/** Whole-feed ceiling, so a feed of many series cannot blow up either. */
const MAX_OCCURRENCES_TOTAL = 2000
/** Iterator safety valve, independent of how many we keep. */
const MAX_ITERATIONS_PER_SERIES = 5000

function stamp(time: ICAL.Time): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${time.year}${p(time.month)}${p(time.day)}T${p(time.hour)}${p(time.minute)}`
}

function readText(vevent: ICAL.Component, name: string): string | undefined {
  const value = vevent.getFirstPropertyValue(name)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Expand one VEVENT into the occurrences that fall inside the window.
 *
 * `skipStamps` carries the RECURRENCE-ID slots that an override VEVENT has
 * already claimed, so the master does not also emit them.
 */
function expandSeries(
  vevent: ICAL.Component,
  ctx: ParseIcsContext,
  skipStamps: ReadonlySet<string>,
  budget: number,
  /**
   * Set when this VEVENT is a RECURRENCE-ID override. Carries the stamp of the
   * slot it replaces, which becomes its externalId — so a moved instance keeps
   * the identity of the slot it came from and updates in place across polls
   * instead of arriving as a second matter. Without this every override on a
   * series would fall back to the bare uid and collide with its siblings on the
   * unique index.
   */
  overrideSlot?: string,
): IcsOccurrence[] {
  const dtstart = vevent.getFirstProperty('dtstart')
  if (!dtstart) return []

  const uid = readText(vevent, 'uid')
  if (!uid) return []

  const summary = readText(vevent, 'summary') ?? '(untitled)'
  const description = readText(vevent, 'description')
  const location = readText(vevent, 'location')
  const rawLine = dtstart.toICALString()

  // Classify ONCE — every occurrence in a series inherits the master's zone —
  // then resolve each occurrence's own wall clock against it.
  const spec = classifyIcsZone(dtstart)
  const startTime = dtstart.getFirstValue() as ICAL.Time
  const isRecurring = vevent.getFirstProperty('rrule') !== null

  const emit = (time: ICAL.Time, recurring: boolean): IcsOccurrence => {
    const when = resolveWallClock(readWallClock(time), spec, ctx, rawLine)
    return {
      uid,
      externalId: recurring ? `${uid}::${stamp(time)}` : uid,
      summary,
      description,
      location,
      when,
      isRecurring: recurring,
    }
  }

  if (overrideSlot) {
    const occurrence = { ...emit(startTime, true), externalId: `${uid}::${overrideSlot}` }
    const at = occurrence.when.dueAt
    return at >= ctx.from && at <= ctx.to ? [occurrence] : []
  }

  if (!isRecurring) {
    const occurrence = emit(startTime, false)
    const at = occurrence.when.dueAt
    return at >= ctx.from && at <= ctx.to ? [occurrence] : []
  }

  const out: IcsOccurrence[] = []
  let iterations = 0

  try {
    const expansion = new ICAL.RecurExpansion({ component: vevent, dtstart: startTime })

    for (;;) {
      if (out.length >= Math.min(MAX_OCCURRENCES_PER_SERIES, budget)) break
      if (iterations >= MAX_ITERATIONS_PER_SERIES) break
      iterations += 1

      const next = expansion.next()
      // A finite series ends by returning nothing; an unbounded one never will,
      // which is what the iteration cap above is for.
      if (!next) break

      const occurrence = emit(next, true)
      const at = occurrence.when.dueAt

      // Past the window's end — later occurrences only get later, so stop.
      if (at > ctx.to) break
      if (at < ctx.from) continue
      if (skipStamps.has(stamp(next))) continue

      out.push(occurrence)
    }
  } catch {
    // A malformed RRULE should cost us this one series, not the whole feed.
    return out
  }

  return out
}

/**
 * Parse a feed body into the occurrences inside `[from, to]`.
 *
 * Never throws for feed-content reasons: a single broken VEVENT is skipped, not
 * escalated. A feed is third-party input and one bad row must not stop a parent
 * from getting the other thirty-nine term dates.
 */
export function parseIcsEvents(body: string, ctx: ParseIcsContext): IcsOccurrence[] {
  const comp = new ICAL.Component(ICAL.parse(body))
  const vevents = comp.getAllSubcomponents('vevent')

  // First pass: find the override instances, which carry RECURRENCE-ID. They
  // are emitted as standalone occurrences and their slots are masked out of the
  // master's expansion.
  const overrides: { vevent: ICAL.Component; slot: string }[] = []
  const masters: ICAL.Component[] = []
  const skipByUid = new Map<string, Set<string>>()

  for (const vevent of vevents) {
    const recurrenceId = vevent.getFirstProperty('recurrence-id')
    if (!recurrenceId) {
      masters.push(vevent)
      continue
    }

    const slot = stamp(recurrenceId.getFirstValue() as ICAL.Time)
    overrides.push({ vevent, slot })

    const uid = readText(vevent, 'uid')
    if (!uid) continue
    const set = skipByUid.get(uid) ?? new Set<string>()
    set.add(slot)
    skipByUid.set(uid, set)
  }

  const out: IcsOccurrence[] = []
  const empty: ReadonlySet<string> = new Set<string>()

  // Overrides first, so their slots are already masked when the masters expand.
  for (const { vevent, slot } of overrides) {
    if (out.length >= MAX_OCCURRENCES_TOTAL) break
    try {
      out.push(...expandSeries(vevent, ctx, empty, MAX_OCCURRENCES_TOTAL - out.length, slot))
    } catch {
      // Skip this event, keep the feed.
    }
  }

  for (const vevent of masters) {
    if (out.length >= MAX_OCCURRENCES_TOTAL) break
    const uid = readText(vevent, 'uid')
    const skip = uid ? (skipByUid.get(uid) ?? empty) : empty
    try {
      out.push(...expandSeries(vevent, ctx, skip, MAX_OCCURRENCES_TOTAL - out.length))
    } catch {
      // Skip this event, keep the feed.
    }
  }

  return out.slice(0, MAX_OCCURRENCES_TOTAL)
}
