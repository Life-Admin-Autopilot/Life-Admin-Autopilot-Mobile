import { Types } from 'mongoose'

import type { Domain } from '../../../src/models/User'
import {
  normalizeEstimate,
  normalizeTag,
  type ReminderEntry,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from '../../../src/models/Task'
import { computeRulesReminders } from '../../../src/modules/reminders/leadTime'
import type { SeedDoc } from '../writers/insert'
import type { Rng } from '../rng'

// Turns a loose spec into a Task document the model will accept, applying the
// same derivations the app itself would have applied at creation time.

export interface TaskSpec {
  userId: Types.ObjectId
  title: string
  domain: Domain
  kind: TaskKind
  priority: TaskPriority
  status: TaskStatus
  createdAt: Date
  dueAt?: Date
  notes?: string
  tags?: string[]
  /** Raw minutes; snapped onto the bucket ladder by normalizeEstimate. */
  estimate?: [number, number]
  subtaskTexts?: string[]
  completedAt?: Date
  snoozedUntil?: Date
  deletedAt?: Date
  rescheduleCount?: number
  sourceVoiceNoteId?: Types.ObjectId
  sourceDocumentId?: Types.ObjectId
  sourceTaskKey?: string
  confidence?: 'high' | 'medium' | 'low'
}

export interface TaskSeed extends SeedDoc {
  title: string
  domain: Domain
  kind: TaskKind
  status: TaskStatus
  dueAt?: Date
  createdAt: Date
  sourceVoiceNoteId?: Types.ObjectId
  sourceDocumentId?: Types.ObjectId
  sourceTaskKey?: string
}

// Reminder entries whose moment has already passed MUST carry firedAt.
//
// The worker claims on `reminders: { $elemMatch: { firedAt: null, at: <= now } }`,
// and in Mongo `firedAt: null` also matches a MISSING key. So an unfired
// past entry isn't merely untidy — the first worker tick after seeding would
// fire three years of reminders at once and bury the notification feed.
function scheduleReminders(
  spec: TaskSpec,
  now: Date,
  rng: Rng,
): ReminderEntry[] {
  // A snoozed matter fires once, at the snooze moment, and its deadline
  // schedule is discarded — mirrors setSnoozeReminder() in planReminders.ts.
  if (spec.status === 'snoozed' && spec.snoozedUntil) {
    const at = spec.snoozedUntil
    return at.getTime() > now.getTime()
      ? [{ at, kind: 'due' }]
      : [{ at, kind: 'due', firedAt: new Date(at.getTime() + rng.int(1_000, 90_000)) }]
  }

  const planned = computeRulesReminders(
    { title: spec.title, domain: spec.domain, kind: spec.kind, dueAt: spec.dueAt ?? null },
    spec.createdAt,
  )

  return planned.map((entry) => {
    if (entry.at.getTime() > now.getTime()) return { at: entry.at, kind: entry.kind }
    // A worker tick lands within a minute or so of the moment itself.
    return {
      at: entry.at,
      kind: entry.kind,
      firedAt: new Date(entry.at.getTime() + rng.int(1_000, 90_000)),
    }
  })
}

function buildSubtasks(
  spec: TaskSpec,
  rng: Rng,
): { text: string; done: boolean; createdAt: Date }[] {
  if (!spec.subtaskTexts || spec.subtaskTexts.length === 0) return []
  const done = spec.status === 'done'
  // An open matter with steps is usually part-way through — all-or-nothing
  // would make the progress affordance on the row meaningless.
  const completedUpTo = done ? spec.subtaskTexts.length : rng.int(0, spec.subtaskTexts.length - 1)

  return spec.subtaskTexts.map((text, i) => ({
    text,
    done: i < completedUpTo,
    createdAt: spec.createdAt,
  }))
}

// When the row was last touched. Mongoose would stamp this itself; the seed
// has to derive it, because "last updated" is what the archive is sorted and
// reasoned about by.
function lastTouched(spec: TaskSpec): Date {
  const candidates = [spec.createdAt, spec.completedAt, spec.deletedAt].filter(
    (d): d is Date => d instanceof Date,
  )
  return new Date(Math.max(...candidates.map((d) => d.getTime())))
}

export function makeTask(spec: TaskSpec, now: Date, rng: Rng): TaskSeed {
  const tags = (spec.tags ?? [])
    .map(normalizeTag)
    .filter((t): t is string => t !== null)
    .slice(0, 10)

  const estimate = spec.estimate
    ? normalizeEstimate(
        { minMinutes: spec.estimate[0], maxMinutes: spec.estimate[1] },
        // The user retunes a minority by hand; the rest are the AI's guess.
        rng.chance(0.15) ? 'user' : 'ai',
      )
    : undefined

  const doc: TaskSeed = {
    _id: new Types.ObjectId(),
    userId: spec.userId,
    title: spec.title,
    domain: spec.domain,
    kind: spec.kind,
    status: spec.status,
    priority: spec.priority,
    subtasks: buildSubtasks(spec, rng),
    tags,
    reminders: scheduleReminders(spec, now, rng),
    rescheduleCount: spec.rescheduleCount ?? 0,
    createdAt: spec.createdAt,
    updatedAt: lastTouched(spec),
  }

  if (spec.dueAt) doc.dueAt = spec.dueAt
  if (spec.notes) doc.notes = spec.notes
  if (estimate) doc.estimate = estimate
  if (spec.completedAt) doc.completedAt = spec.completedAt
  if (spec.snoozedUntil) doc.snoozedUntil = spec.snoozedUntil
  if (spec.deletedAt) doc.deletedAt = spec.deletedAt
  if (spec.sourceVoiceNoteId) doc.sourceVoiceNoteId = spec.sourceVoiceNoteId
  if (spec.sourceDocumentId) doc.sourceDocumentId = spec.sourceDocumentId
  if (spec.sourceTaskKey) doc.sourceTaskKey = spec.sourceTaskKey
  if (spec.confidence) doc.confidence = spec.confidence

  return doc
}

/** Fills the `{}` slot in a one-off template title. */
export function fillTitle(template: string, variant: string | undefined): string {
  return variant ? template.replace('{}', variant) : template.replace(' {}', '')
}
