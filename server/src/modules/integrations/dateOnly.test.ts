import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMPORT_TIME,
  TimezoneRequiredError,
  isValidTimeZone,
  parseTimeOfDay,
  resolveDateOnly,
  resolveExact,
  resolveFloating,
  zonedWallClockToUtc,
} from './dateOnly'

const iso = (d: Date): string => d.toISOString()

describe('zonedWallClockToUtc', () => {
  it('converts a fixed-offset zone with no DST', () => {
    // Asia/Dubai is UTC+4 all year, so this is pure arithmetic with nothing to
    // get wrong — the control case for everything below.
    expect(iso(zonedWallClockToUtc(2026, 9, 3, 9, 0, 'Asia/Dubai'))).toBe('2026-09-03T05:00:00.000Z')
  })

  it('applies summer time when the date is inside it', () => {
    // 09:00 BST is 08:00 UTC.
    expect(iso(zonedWallClockToUtc(2026, 7, 15, 9, 0, 'Europe/London'))).toBe(
      '2026-07-15T08:00:00.000Z',
    )
  })

  it('applies standard time when the date is outside it', () => {
    // Same wall clock, same zone, five months apart — 09:00 GMT is 09:00 UTC.
    // A naive implementation that caches one offset per zone fails exactly here.
    expect(iso(zonedWallClockToUtc(2026, 1, 15, 9, 0, 'Europe/London'))).toBe(
      '2026-01-15T09:00:00.000Z',
    )
  })

  it('lands correctly either side of a DST transition', () => {
    // BST ends 2026-10-25. The day before and the day after must differ by an
    // hour in UTC despite carrying the identical local wall clock. This is the
    // case a single-pass offset lookup gets wrong.
    expect(iso(zonedWallClockToUtc(2026, 10, 24, 9, 0, 'Europe/London'))).toBe(
      '2026-10-24T08:00:00.000Z',
    )
    expect(iso(zonedWallClockToUtc(2026, 10, 26, 9, 0, 'Europe/London'))).toBe(
      '2026-10-26T09:00:00.000Z',
    )
  })

  it('produces a sane instant for a local time that does not exist', () => {
    // Clocks jump 01:00 -> 02:00 on 2026-03-29, so 01:30 local never happens.
    // There is no correct answer; the requirement is that we stay on the right
    // DAY rather than rolling into the previous one, which is what would
    // actually surface as a wrong reminder.
    const result = zonedWallClockToUtc(2026, 3, 29, 1, 30, 'Europe/London')
    expect(Number.isNaN(result.getTime())).toBe(false)
    expect(iso(result).slice(0, 10)).toBe('2026-03-29')
  })

  it('handles a southern-hemisphere zone, where DST runs the other way', () => {
    // Australia/Sydney is UTC+10 in July (standard) and UTC+11 in January.
    expect(iso(zonedWallClockToUtc(2026, 7, 15, 9, 0, 'Australia/Sydney'))).toBe(
      '2026-07-14T23:00:00.000Z',
    )
    expect(iso(zonedWallClockToUtc(2026, 1, 15, 9, 0, 'Australia/Sydney'))).toBe(
      '2026-01-14T22:00:00.000Z',
    )
  })
})

describe('parseTimeOfDay', () => {
  it('parses a well-formed 24-hour value', () => {
    expect(parseTimeOfDay('07:30')).toEqual({ hours: 7, minutes: 30 })
    expect(parseTimeOfDay('23:59')).toEqual({ hours: 23, minutes: 59 })
  })

  it('falls back to the default rather than to midnight', () => {
    // Midnight is the dangerous fallback: a malformed preference would fire
    // reminders at 00:00 and users do not report that, they just mute the app.
    const [dh, dm] = DEFAULT_IMPORT_TIME.split(':').map(Number)
    for (const bad of [undefined, null, '', 'nine', '9', '24:00', '12:60', '-1:00']) {
      expect(parseTimeOfDay(bad)).toEqual({ hours: dh, minutes: dm })
    }
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects everything else', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true)
    expect(isValidTimeZone('Africa/Cairo')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone(undefined)).toBe(false)
  })
})

describe('resolveDateOnly', () => {
  it('applies the user default time in the user zone', () => {
    const result = resolveDateOnly({
      date: '2026-09-03',
      timezone: 'Asia/Dubai',
      defaultTimeOfDay: '09:00',
    })
    expect(iso(result.dueAt)).toBe('2026-09-03T05:00:00.000Z')
    expect(result.precision).toBe('dateOnly')
  })

  it('stays high confidence, because nothing was inferred', () => {
    // The date came from the source and the time came from the user. Neither is
    // a guess, so this must NOT be downgraded — doing so would train users to
    // ignore the warning tone on floating times, which genuinely is a guess.
    const result = resolveDateOnly({ date: '2026-09-03', timezone: 'Asia/Dubai' })
    expect(result.confidence).toBe('high')
    expect(result.needsConfirmation).toBe(false)
  })

  it('names the default time in the provenance note', () => {
    // The citation chip has to be able to say WHERE the time came from.
    const result = resolveDateOnly({
      date: '2026-09-03',
      timezone: 'Asia/Dubai',
      defaultTimeOfDay: '07:30',
    })
    expect(result.note).toContain('07:30')
    expect(result.note).toContain('date only')
  })

  it('refuses to guess a timezone', () => {
    // Defaulting to UTC here would move every imported reminder for a Cairo user
    // by two hours, invisibly. Throwing forces the import flow to ask.
    expect(() => resolveDateOnly({ date: '2026-09-03', timezone: '' })).toThrow(
      TimezoneRequiredError,
    )
    expect(() => resolveDateOnly({ date: '2026-09-03', timezone: 'Nope/Nope' })).toThrow(
      TimezoneRequiredError,
    )
  })

  it('rejects an unparseable date rather than producing an epoch', () => {
    expect(() => resolveDateOnly({ date: 'soon', timezone: 'Asia/Dubai' })).toThrow()
  })
})

describe('resolveFloating', () => {
  it('resolves in the user zone but demands confirmation', () => {
    // RFC 5545 floating time: "09:00 wherever the observer is". We follow the
    // spec, then flag it, because publishers routinely mean a specific zone and
    // omit it — and a London school feed read in Dubai moves the school run by
    // four hours.
    const result = resolveFloating({
      date: '2026-09-03',
      timeOfDay: '09:00',
      timezone: 'Asia/Dubai',
    })
    expect(iso(result.dueAt)).toBe('2026-09-03T05:00:00.000Z')
    expect(result.precision).toBe('floating')
    expect(result.confidence).toBe('low')
    expect(result.needsConfirmation).toBe(true)
  })

  it('says in the note that the zone was assumed', () => {
    const result = resolveFloating({
      date: '2026-09-03',
      timeOfDay: '09:00',
      timezone: 'Europe/London',
    })
    expect(result.note).toMatch(/timezone/i)
  })

  it('refuses to guess a timezone', () => {
    expect(() =>
      resolveFloating({ date: '2026-09-03', timeOfDay: '09:00', timezone: '' }),
    ).toThrow(TimezoneRequiredError)
  })
})

describe('resolveExact', () => {
  it('passes the instant through untouched', () => {
    const instant = new Date('2026-09-03T14:00:00.000Z')
    const result = resolveExact(instant)
    expect(iso(result.dueAt)).toBe('2026-09-03T14:00:00.000Z')
    expect(result.precision).toBe('exact')
    expect(result.confidence).toBe('high')
    expect(result.needsConfirmation).toBe(false)
  })
})
