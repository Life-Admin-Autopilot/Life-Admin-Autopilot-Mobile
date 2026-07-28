import { addDays, startOfDay } from '../calendar'
import type { TaskSeed } from '../generators/taskFactory'

// Assertions that run on every seed, dry or wet, BEFORE anything is written.
//
// These are not tests of the generators so much as a tripwire on the two
// mistakes that are expensive to discover afterwards: a reminder the worker
// will re-fire, and a date that makes no sense against the row next to it.
// Both look fine in a count table and only surface once the app is running.

export interface Violation {
  rule: string
  detail: string
}

export function checkTasks(tasks: TaskSeed[], now: Date): Violation[] {
  const out: Violation[] = []
  const add = (rule: string, detail: string): void => {
    if (out.length < 40) out.push({ rule, detail })
  }

  const sourceKeys = new Set<string>()

  for (const t of tasks) {
    const created = t.createdAt
    const updated = t.updatedAt as Date
    const completed = t.completedAt as Date | undefined

    if (t.kind === 'reminder' && !t.dueAt) {
      add('reminder-needs-due', t.title)
    }

    // The one that matters most. `firedAt: null` in Mongo also matches a
    // MISSING key, so an unfired past entry is a notification the worker will
    // send the moment the server boots.
    for (const entry of (t.reminders as { at: Date; firedAt?: Date }[] | undefined) ?? []) {
      if (entry.at.getTime() <= now.getTime() && !entry.firedAt) {
        add('past-reminder-unfired', `${t.title} @ ${entry.at.toISOString()}`)
      }
    }

    if (created.getTime() > now.getTime()) {
      add('created-in-future', `${t.title} @ ${created.toISOString()}`)
    }
    if (updated.getTime() < created.getTime()) {
      add('updated-before-created', t.title)
    }
    if (t.status === 'done' && !completed) {
      add('done-without-completedAt', t.title)
    }
    if (completed && completed.getTime() < created.getTime()) {
      add('completed-before-created', t.title)
    }
    if (completed && completed.getTime() > now.getTime()) {
      add('completed-in-future', t.title)
    }

    const tags = (t.tags as string[] | undefined) ?? []
    if (tags.length > 10) add('too-many-tags', t.title)
    const subtasks = (t.subtasks as unknown[] | undefined) ?? []
    if (subtasks.length > 50) add('too-many-subtasks', t.title)

    // The partial unique indexes on (userId, sourceVoiceNoteId, sourceTaskKey)
    // and (userId, sourceDocumentId, sourceTaskKey) turn a collision into a
    // failed insert halfway through the run.
    const parent = t.sourceVoiceNoteId ?? t.sourceDocumentId
    if (parent && t.sourceTaskKey) {
      const composite = `${String(parent)}:${t.sourceTaskKey}`
      if (sourceKeys.has(composite)) add('duplicate-source-key', composite)
      sourceKeys.add(composite)
    }
  }

  return out
}

/** What the user will actually see, so the shape can be eyeballed pre-write. */
export function describeLive(tasks: TaskSeed[], now: Date): Record<string, number> {
  const today = startOfDay(now)
  const tomorrow = addDays(today, 1)
  const dayAfter = addDays(today, 2)
  const weekEnd = addDays(today, 7)
  const slipCutoff = addDays(today, -14)

  const live = tasks.filter(
    (t) => !t.deletedAt && (t.status === 'open' || t.status === 'snoozed'),
  )
  const withDue = live.filter((t) => t.dueAt)

  const inRange = (from: Date, to: Date): number =>
    withDue.filter((t) => t.dueAt! >= from && t.dueAt! < to).length

  return {
    'open + snoozed': live.length,
    overdue: withDue.filter((t) => t.dueAt! < today).length,
    'of which slipping': live.filter(
      (t) =>
        (t.rescheduleCount as number) >= 3 || (t.dueAt !== undefined && t.dueAt < slipCutoff),
    ).length,
    today: inRange(today, tomorrow),
    tomorrow: inRange(tomorrow, dayAfter),
    'this week': inRange(dayAfter, weekEnd),
    later: withDue.filter((t) => t.dueAt! >= weekEnd).length,
    'no date': live.filter((t) => !t.dueAt).length,
    snoozed: live.filter((t) => t.status === 'snoozed').length,
    '— done (archive)': tasks.filter((t) => t.status === 'done').length,
    '— in trash': tasks.filter((t) => t.deletedAt).length,
  }
}
