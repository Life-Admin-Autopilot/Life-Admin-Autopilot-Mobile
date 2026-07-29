import { describe, expect, it } from 'vitest'
import { triageEvent } from './triageEvent'

describe('triageEvent — matters', () => {
  it('treats a solo self-organised event as a matter', () => {
    // The case this whole feature was designed around: "Dentist Tuesday 14:00"
    // that you put in your own calendar, for yourself.
    expect(
      triageEvent({
        eventType: 'default',
        status: 'confirmed',
        organizer: { self: true },
      }),
    ).toBe('matter')
  })

  it('treats an event with no organizer block as a matter', () => {
    // Personal calendars frequently omit organizer entirely. Defaulting those to
    // 'commitment' would silence the nudge on most of a personal calendar.
    expect(triageEvent({ status: 'confirmed' })).toBe('matter')
  })

  it('treats an empty attendee array as solo', () => {
    // Google sends `attendees: []` as well as omitting it. A length check
    // handles both; a truthiness check would misfile every one of these.
    expect(triageEvent({ attendees: [], organizer: { self: true } })).toBe('matter')
  })
})

describe('triageEvent — commitments', () => {
  it('treats an event with attendees as a commitment', () => {
    // The invite already carries reminders. A second nudge from Kitto is the
    // notification pile-up smart-reminder-conflict-spec.md exists to prevent.
    expect(
      triageEvent({
        status: 'confirmed',
        attendees: [{ email: 'someone@example.com' }],
        organizer: { self: true },
      }),
    ).toBe('commitment')
  })

  it('treats a recurring series as a commitment', () => {
    expect(triageEvent({ recurrence: ['RRULE:FREQ=WEEKLY'] })).toBe('commitment')
    expect(triageEvent({ recurringEventId: 'abc123' })).toBe('commitment')
  })

  it('treats an event organised by someone else as a commitment', () => {
    expect(triageEvent({ organizer: { self: false, email: 'boss@example.com' } })).toBe(
      'commitment',
    )
  })

  it('falls back to creator when there is no organizer', () => {
    expect(triageEvent({ creator: { self: false, email: 'boss@example.com' } })).toBe('commitment')
  })
})

describe('triageEvent — ignored', () => {
  it('ignores working-location markers', () => {
    // One per working day per user. Filed as matters they would bury the list.
    expect(triageEvent({ eventType: 'workingLocation' })).toBe('ignore')
  })

  it('ignores birthdays, focus time and out-of-office', () => {
    for (const eventType of ['birthday', 'focusTime', 'outOfOffice']) {
      expect(triageEvent({ eventType })).toBe('ignore')
    }
  })

  it('ignores an event the user marked themselves free for', () => {
    expect(triageEvent({ transparency: 'transparent', organizer: { self: true } })).toBe('ignore')
  })

  it('ignores cancelled tombstones', () => {
    // Incremental sync communicates deletions as cancelled instances. Filing one
    // would recreate the very thing that was deleted.
    expect(triageEvent({ status: 'cancelled', attendees: [{ email: 'a@example.com' }] })).toBe(
      'ignore',
    )
  })

  it('puts cancelled ahead of every other signal', () => {
    expect(triageEvent({ status: 'cancelled', organizer: { self: true } })).toBe('ignore')
  })
})

describe('triageEvent — precedence', () => {
  it('keeps a fromGmail event in play rather than ignoring it', () => {
    // Flight and hotel confirmations Google parses out of Gmail land here, and
    // they are genuine life admin — exactly the content Kitto wants.
    expect(triageEvent({ eventType: 'fromGmail', organizer: { self: true } })).toBe('matter')
  })

  it('prefers commitment over matter when signals conflict', () => {
    expect(
      triageEvent({
        eventType: 'default',
        organizer: { self: true },
        attendees: [{ email: 'a@example.com' }],
        recurrence: ['RRULE:FREQ=DAILY'],
      }),
    ).toBe('commitment')
  })
})
