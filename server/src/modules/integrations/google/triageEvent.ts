// Decide what a calendar event is TO Kitto, entirely in code.
//
// A busy calendar is thousands of events per user. Asking a model about each
// one would land directly on the margin business-model.md measures (~$3.29/user
// /month against ~$6.79 net), so every signal used here is read straight off
// the Event payload. This mirrors the note in modules/tasks/summarize.ts:
// detected in CODE, not by the model.
//
// Three roles, and the distinction is a product decision rather than a
// technical one:
//
//   matter     — something you have to DO. "Dentist Tuesday 14:00" put in your
//                own calendar by you, for you. Gets the full treatment: domain,
//                lead-time nudge, reminders.
//
//   commitment — something already handled. A meeting someone else organised,
//                a recurring standup. Kitto shows it and counts it as occupied
//                time so the conflict engine in smart-reminder-conflict-spec.md
//                has its missing third signal — but it does NOT nudge, because
//                the invite already does and notification pile-up is the exact
//                thing that spec exists to fix.
//
//   ignore     — noise. Working-location markers are one per day and mean
//                nothing to life admin; a birthday is not a task.
//
// The dividing line between matter and commitment is "did anyone else agree to
// this". An event with attendees has its own reminder machinery and its own
// social accountability. An event you put in your own calendar alone is a note
// to self, and a note to self is precisely what Kitto is for.

export type EventRole = 'matter' | 'commitment' | 'ignore'

export interface TriageEvent {
  eventType?: string
  status?: string
  transparency?: string
  recurringEventId?: string
  recurrence?: string[]
  attendees?: { email?: string; self?: boolean; responseStatus?: string }[]
  organizer?: { email?: string; self?: boolean }
  creator?: { email?: string; self?: boolean }
}

// eventTypes that are never an obligation. `workingLocation` is the big one —
// Google emits one per working day per user, so treating them as matters would
// bury the real list under "Office" entries.
const IGNORED_EVENT_TYPES = new Set(['workingLocation', 'birthday', 'focusTime', 'outOfOffice'])

export function triageEvent(event: TriageEvent): EventRole {
  // Cancelled instances arrive through incremental sync as tombstones. They are
  // how a deletion is communicated, not something to file.
  if (event.status === 'cancelled') return 'ignore'

  if (event.eventType && IGNORED_EVENT_TYPES.has(event.eventType)) return 'ignore'

  // The user marked themselves free. They are telling us this does not occupy
  // them, so it is neither a task nor a busy block.
  if (event.transparency === 'transparent') return 'ignore'

  // Someone else agreed to be there. The invite carries its own reminders, and
  // a second nudge from Kitto is notification pile-up.
  if (event.attendees && event.attendees.length > 0) return 'commitment'

  // Recurring means routine. A weekly slot you already know about does not need
  // a lead-time nudge every single week.
  if (event.recurringEventId || (event.recurrence && event.recurrence.length > 0)) {
    return 'commitment'
  }

  // Someone else put this in your calendar. Even with no attendee list, it is
  // not a note to self.
  //
  // `self` is checked rather than comparing emails: Google sets it against the
  // authenticated user, which is authoritative in a way string comparison is
  // not — people have aliases, and a mismatched alias would misfile every event
  // they own. When organizer is absent entirely we fall through to `matter`,
  // because a personal calendar's own entries frequently omit it.
  if (event.organizer && event.organizer.self === false) return 'commitment'
  if (!event.organizer && event.creator && event.creator.self === false) return 'commitment'

  return 'matter'
}
