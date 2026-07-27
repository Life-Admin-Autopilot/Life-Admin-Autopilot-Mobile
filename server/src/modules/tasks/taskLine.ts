import type { TaskDoc } from '../../models/Task'

// How a matter is described TO the model, in one place.
//
// The state is resolved here rather than left as a bare date, because a model
// given only a date reads state off the title instead — a matter called "Pay
// overdue veterinary bill" that is due next week came back described as
// overdue. Titles are prose; these computed fields are the reality.
//
// Shared by search and the range summary so a matter reads identically in both,
// and so a fix to the phrasing lands everywhere at once.

const DAY_MS = 86_400_000

export function formatTaskLine(t: TaskDoc, now: Date): string {
  const parts = [`[${String(t._id)}]`, t.title, '·', t.domain, '·']

  if (t.status === 'done') {
    parts.push(t.completedAt ? `DONE ${t.completedAt.toISOString().slice(0, 10)}` : 'DONE')
  } else if (!t.dueAt) {
    parts.push('NO DATE')
  } else {
    const days = Math.round((t.dueAt.getTime() - now.getTime()) / DAY_MS)
    const date = t.dueAt.toISOString().slice(0, 10)
    if (days < 0) parts.push(`OVERDUE by ${Math.abs(days)}d (was due ${date})`)
    else if (days === 0) parts.push(`DUE TODAY (${date})`)
    else parts.push(`UPCOMING in ${days}d (${date})`)
  }

  if (t.status === 'snoozed') parts.push('· snoozed')
  if (t.rescheduleCount > 0) parts.push(`· moved ${t.rescheduleCount}x`)
  if (t.tags.length > 0) parts.push(`· tags: ${t.tags.join(',')}`)
  // Notes carry the detail a half-remembered search is often reaching for
  // ("that thing about the policy number"), so a trimmed slice goes in.
  if (t.notes) parts.push(`· notes: ${t.notes.slice(0, 160)}`)

  return parts.join(' ')
}
