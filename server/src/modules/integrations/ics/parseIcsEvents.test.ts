import { describe, expect, it } from 'vitest'
import { parseIcsEvents } from './parseIcsEvents'

const USER_TZ = 'Asia/Dubai'
const WIDE = { from: new Date('2020-01-01T00:00:00Z'), to: new Date('2030-01-01T00:00:00Z') }

function feed(...veventLines: string[][]): string {
  const body = veventLines.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'])
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...body, 'END:VCALENDAR'].join(
    '\r\n',
  )
}

const ctx = { timezone: USER_TZ, defaultTimeOfDay: '09:00', ...WIDE }
const iso = (d: Date): string => d.toISOString()

describe('parseIcsEvents — single events', () => {
  it('emits one occurrence and uses the bare uid as externalId', () => {
    const events = parseIcsEvents(
      feed(['UID:one', 'DTSTART;TZID=Europe/London:20260903T090000', 'SUMMARY:Parents evening']),
      ctx,
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.uid).toBe('one')
    expect(events[0]?.externalId).toBe('one')
    expect(events[0]?.isRecurring).toBe(false)
    expect(iso(events[0]!.when.dueAt)).toBe('2026-09-03T08:00:00.000Z')
  })

  it('excludes occurrences outside the window', () => {
    const events = parseIcsEvents(
      feed(['UID:old', 'DTSTART:20200101T090000Z', 'SUMMARY:Ancient']),
      { ...ctx, from: new Date('2026-01-01T00:00:00Z'), to: new Date('2027-01-01T00:00:00Z') },
    )
    expect(events).toHaveLength(0)
  })

  it('carries description and location through', () => {
    const events = parseIcsEvents(
      feed([
        'UID:two',
        'DTSTART:20260903T090000Z',
        'SUMMARY:Dentist',
        'DESCRIPTION:Bring the referral letter',
        'LOCATION:12 High Street',
      ]),
      ctx,
    )
    expect(events[0]?.description).toBe('Bring the referral letter')
    expect(events[0]?.location).toBe('12 High Street')
  })
})

describe('parseIcsEvents — recurrence', () => {
  it('expands a bounded series', () => {
    const events = parseIcsEvents(
      feed([
        'UID:weekly',
        'DTSTART:20260901T090000Z',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'SUMMARY:Swimming',
      ]),
      ctx,
    )
    expect(events).toHaveLength(4)
    expect(events.every((e) => e.isRecurring)).toBe(true)
  })

  it('converts every occurrence independently across a DST boundary', () => {
    // THE test for recurrence correctness. BST ends 2026-10-25, so a weekly
    // 09:00 Europe/London series is 08:00Z before and 09:00Z after. Expanding
    // once and adding seven days repeatedly would keep every occurrence at
    // 08:00Z and put the school run an hour early for the rest of the year.
    const events = parseIcsEvents(
      feed([
        'UID:term',
        'DTSTART;TZID=Europe/London:20261020T090000',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'SUMMARY:Assembly',
      ]),
      ctx,
    )
    expect(events.map((e) => iso(e.when.dueAt))).toEqual([
      '2026-10-20T08:00:00.000Z', // BST
      '2026-10-27T09:00:00.000Z', // GMT
      '2026-11-03T09:00:00.000Z', // GMT
    ])
  })

  it('gives each occurrence a distinct, stable externalId', () => {
    const parse = (): string[] =>
      parseIcsEvents(
        feed([
          'UID:weekly',
          'DTSTART:20260901T090000Z',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'SUMMARY:Swimming',
        ]),
        ctx,
      ).map((e) => e.externalId)

    const first = parse()
    expect(new Set(first).size).toBe(3)
    // Stable across polls — otherwise every poll creates three new matters.
    expect(parse()).toEqual(first)
  })

  it('keeps externalIds stable when the user changes timezone', () => {
    // Built from the occurrence's own wall clock rather than the resolved UTC
    // instant, so moving abroad re-files existing matters instead of
    // duplicating every one of them.
    const build = (timezone: string): string[] =>
      parseIcsEvents(
        feed([
          'UID:weekly',
          'DTSTART:20260901T090000',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'SUMMARY:Swimming',
        ]),
        { ...ctx, timezone },
      ).map((e) => e.externalId)

    expect(build('Asia/Dubai')).toEqual(build('Europe/London'))
  })

  it('caps an unbounded RRULE instead of hanging', () => {
    // FREQ=DAILY with no UNTIL and no COUNT is legal and infinite. A stranger's
    // feed URL must not be able to spin the server.
    const started = Date.now()
    const events = parseIcsEvents(
      feed(['UID:forever', 'DTSTART:20260101T090000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Endless']),
      ctx,
    )
    expect(events.length).toBeLessThanOrEqual(400)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('honours EXDATE', () => {
    const events = parseIcsEvents(
      feed([
        'UID:weekly',
        'DTSTART:20260901T090000Z',
        'RRULE:FREQ=WEEKLY;COUNT=3',
        'EXDATE:20260908T090000Z',
        'SUMMARY:Swimming',
      ]),
      ctx,
    )
    expect(events.map((e) => iso(e.when.dueAt))).toEqual([
      '2026-09-01T09:00:00.000Z',
      '2026-09-15T09:00:00.000Z',
    ])
  })
})

describe('parseIcsEvents — RECURRENCE-ID overrides', () => {
  it('replaces the overridden slot rather than emitting both', () => {
    // A moved instance arrives as a second VEVENT with the same UID. Expanding
    // the master blindly would yield the original slot AND the override — two
    // matters for one event.
    const events = parseIcsEvents(
      feed(
        ['UID:weekly', 'DTSTART:20260901T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Swimming'],
        [
          'UID:weekly',
          'RECURRENCE-ID:20260908T090000Z',
          'DTSTART:20260908T140000Z',
          'SUMMARY:Swimming (moved)',
        ],
      ),
      ctx,
    )

    expect(events).toHaveLength(3)
    const times = events.map((e) => iso(e.when.dueAt)).sort()
    expect(times).toEqual([
      '2026-09-01T09:00:00.000Z',
      '2026-09-08T14:00:00.000Z', // moved, not 09:00
      '2026-09-15T09:00:00.000Z',
    ])
  })

  it('keys the override to the slot it replaces, so siblings cannot collide', () => {
    // Two overrides on one series would otherwise both fall back to the bare
    // uid and collide on the (userId, externalSource, externalId) unique index.
    const events = parseIcsEvents(
      feed(
        ['UID:weekly', 'DTSTART:20260901T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Swimming'],
        ['UID:weekly', 'RECURRENCE-ID:20260908T090000Z', 'DTSTART:20260908T140000Z', 'SUMMARY:A'],
        ['UID:weekly', 'RECURRENCE-ID:20260915T090000Z', 'DTSTART:20260915T160000Z', 'SUMMARY:B'],
      ),
      ctx,
    )
    const ids = events.map((e) => e.externalId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('weekly::20260908T0900')
  })
})

describe('parseIcsEvents — resilience', () => {
  it('skips a VEVENT with no UID rather than dropping the feed', () => {
    const events = parseIcsEvents(
      feed(
        ['DTSTART:20260903T090000Z', 'SUMMARY:No uid'],
        ['UID:good', 'DTSTART:20260904T090000Z', 'SUMMARY:Fine'],
      ),
      ctx,
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.uid).toBe('good')
  })

  it('skips a VEVENT with no DTSTART', () => {
    const events = parseIcsEvents(
      feed(['UID:nodate', 'SUMMARY:Undated'], ['UID:good', 'DTSTART:20260904T090000Z', 'SUMMARY:Fine']),
      ctx,
    )
    expect(events).toHaveLength(1)
  })

  it('falls back to a placeholder title rather than an empty one', () => {
    const events = parseIcsEvents(feed(['UID:x', 'DTSTART:20260903T090000Z']), ctx)
    expect(events[0]?.summary).toBe('(untitled)')
  })

  it('flags a floating recurring series for confirmation on every occurrence', () => {
    const events = parseIcsEvents(
      feed(['UID:f', 'DTSTART:20260901T090000', 'RRULE:FREQ=WEEKLY;COUNT=2', 'SUMMARY:Club']),
      ctx,
    )
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.when.needsConfirmation)).toBe(true)
    expect(events.every((e) => e.when.confidence === 'low')).toBe(true)
  })
})
