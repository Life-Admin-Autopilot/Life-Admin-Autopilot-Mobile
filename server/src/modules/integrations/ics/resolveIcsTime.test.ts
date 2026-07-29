import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { resolveIcsTime } from './resolveIcsTime'

const USER_TZ = 'Asia/Dubai' // UTC+4, no DST — keeps the user side of the maths trivial

// Build a minimal VCALENDAR around one DTSTART line and hand back the property.
// Deliberately NO VTIMEZONE block: that is the shape real school and council
// feeds ship, and it is what makes ical.js report a TZID'd event as "floating".
function dtstartOf(dtstartLine: string): ICAL.Property {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//test//EN',
    'BEGIN:VEVENT',
    'UID:test-1',
    dtstartLine,
    'SUMMARY:Test',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const vevent = new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')[0]
  if (!vevent) throw new Error('fixture produced no VEVENT')
  const prop = vevent.getFirstProperty('dtstart')
  if (!prop) throw new Error('fixture produced no DTSTART')
  return prop
}

const iso = (d: Date): string => d.toISOString()

describe('resolveIcsTime — all-day', () => {
  it('applies the user default time in the user zone', () => {
    const result = resolveIcsTime(dtstartOf('DTSTART;VALUE=DATE:20260903'), {
      timezone: USER_TZ,
      defaultTimeOfDay: '09:00',
    })
    expect(result.precision).toBe('dateOnly')
    expect(iso(result.dueAt)).toBe('2026-09-03T05:00:00.000Z') // 09:00 +04
    expect(result.confidence).toBe('high')
    expect(result.needsConfirmation).toBe(false)
  })

  it('does not treat an all-day event as midnight', () => {
    // ICAL.Time reports hour 0 for a DATE value. Passing that through as a real
    // time would schedule every school-term reminder at midnight.
    const result = resolveIcsTime(dtstartOf('DTSTART;VALUE=DATE:20260903'), {
      timezone: USER_TZ,
      defaultTimeOfDay: '07:30',
    })
    expect(iso(result.dueAt)).toBe('2026-09-03T03:30:00.000Z') // 07:30 +04
  })
})

describe('resolveIcsTime — explicit UTC', () => {
  it('passes the instant through without conversion', () => {
    const result = resolveIcsTime(dtstartOf('DTSTART:20260903T090000Z'), { timezone: USER_TZ })
    expect(result.precision).toBe('exact')
    expect(iso(result.dueAt)).toBe('2026-09-03T09:00:00.000Z')
    expect(result.confidence).toBe('high')
    expect(result.note).toContain('UTC')
  })
})

describe('resolveIcsTime — TZID with no VTIMEZONE (the reason this module exists)', () => {
  it('converts from the named zone, not from the server clock', () => {
    // THE regression guard. ical.js cannot register Europe/London here, so
    // toJSDate() would resolve 09:00 against the server's local zone — on a UTC
    // box that yields 09:00Z. The correct answer in September (BST, UTC+1) is
    // 08:00Z. This assertion fails the moment anyone reintroduces toJSDate().
    const result = resolveIcsTime(dtstartOf('DTSTART;TZID=Europe/London:20260903T090000'), {
      timezone: USER_TZ,
    })
    expect(iso(result.dueAt)).toBe('2026-09-03T08:00:00.000Z')
    expect(result.precision).toBe('exact')
    expect(result.confidence).toBe('high')
    expect(result.note).toContain('Europe/London')
    expect(result.needsConfirmation).toBe(false)
  })

  it('tracks the named zone across its own DST boundary', () => {
    // Same feed, same wall clock, January — GMT this time, so 09:00Z.
    const result = resolveIcsTime(dtstartOf('DTSTART;TZID=Europe/London:20260115T090000'), {
      timezone: USER_TZ,
    })
    expect(iso(result.dueAt)).toBe('2026-01-15T09:00:00.000Z')
  })

  it('is unaffected by the user zone, because the source specified one', () => {
    const london = 'DTSTART;TZID=Europe/London:20260903T090000'
    const forDubai = resolveIcsTime(dtstartOf(london), { timezone: 'Asia/Dubai' })
    const forNewYork = resolveIcsTime(dtstartOf(london), { timezone: 'America/New_York' })
    expect(iso(forDubai.dueAt)).toBe(iso(forNewYork.dueAt))
  })
})

describe('resolveIcsTime — floating', () => {
  it('resolves in the user zone but demands confirmation', () => {
    const result = resolveIcsTime(dtstartOf('DTSTART:20260903T090000'), { timezone: USER_TZ })
    expect(result.precision).toBe('floating')
    expect(iso(result.dueAt)).toBe('2026-09-03T05:00:00.000Z') // 09:00 +04
    expect(result.confidence).toBe('low')
    expect(result.needsConfirmation).toBe(true)
  })

  it('moves with the user zone, which is exactly why it is low confidence', () => {
    // The expat case from overview.md: the same feed line lands four hours apart
    // for a London parent and a Dubai parent. Neither reading is wrong; that is
    // the problem, and it is why we ask instead of scheduling silently.
    const line = 'DTSTART:20260903T090000'
    const dubai = resolveIcsTime(dtstartOf(line), { timezone: 'Asia/Dubai' })
    const london = resolveIcsTime(dtstartOf(line), { timezone: 'Europe/London' })
    expect(iso(dubai.dueAt)).toBe('2026-09-03T05:00:00.000Z')
    expect(iso(london.dueAt)).toBe('2026-09-03T08:00:00.000Z')
    expect(dubai.needsConfirmation).toBe(true)
    expect(london.needsConfirmation).toBe(true)
  })
})

describe('resolveIcsTime — unresolvable TZID', () => {
  it('degrades a Windows zone name to low confidence instead of guessing', () => {
    // Outlook-generated feeds emit Windows zone identifiers, which are not IANA
    // and which Intl rejects. We know a zone was intended and do not know which,
    // so this is honestly the same epistemic state as a floating time.
    const result = resolveIcsTime(
      dtstartOf('DTSTART;TZID="GMT Standard Time":20260903T090000'),
      { timezone: USER_TZ },
    )
    expect(result.precision).toBe('floating')
    expect(result.confidence).toBe('low')
    expect(result.needsConfirmation).toBe(true)
    expect(result.note).toContain('GMT Standard Time')
  })

  it('does not throw on a nonsense TZID', () => {
    expect(() =>
      resolveIcsTime(dtstartOf('DTSTART;TZID=Mars/Olympus:20260903T090000'), {
        timezone: USER_TZ,
      }),
    ).not.toThrow()
  })
})

describe('resolveIcsTime — provenance', () => {
  it('keeps the original DTSTART line verbatim for the source viewer', () => {
    // For a low-confidence floating time the raw line IS the evidence the user
    // is being asked to judge, so it must not be paraphrased.
    const result = resolveIcsTime(dtstartOf('DTSTART:20260903T090000'), { timezone: USER_TZ })
    expect(result.rawLine).toContain('DTSTART')
    expect(result.rawLine).toContain('20260903T090000')
  })
})
