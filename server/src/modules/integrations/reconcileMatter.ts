// The three rules for turning an external item into a matter, in one place.
//
// Every importer needs exactly these, and a divergence between two copies is a
// user-visible bug rather than a style issue — so they live here rather than
// being written out per integration:
//
//   1. Upsert on (userId, externalSource, externalId). Nothing we sync from has
//      reliable push, so every importer re-reads an overlapping window. A blind
//      insert is how one appointment becomes a matter every hour.
//
//   2. A matter the user deleted stays deleted. Task soft-deletes, so an
//      importer that ignored `deletedAt` would resurrect everything the user
//      swept away — and they would have to sweep it again after every poll.
//
//   3. Updates touch timing only. Once a matter exists the user owns its title,
//      notes and domain; rewriting them would silently undo "rename this to
//      something I understand". The source stays authoritative for WHEN, the
//      user for WHAT.

import { Task, type ExternalSource, type TaskDoc, type TimePrecision } from '../../models/Task'
import type { ConfidenceBucket } from '../../models/Task'
import type { Domain } from '../../models/User'
import { setRulesReminders } from '../reminders/planReminders'

export interface ExternalMatterInput {
  userId: unknown
  externalSource: ExternalSource
  /** Stable per-item id from the source. Must not change between polls. */
  externalId: string
  title: string
  domain: Domain
  dueAt: Date
  /**
   * `reminder` fires; `list` is passive. An item whose time we had to assume
   * must arrive as `list` — principles.md says ask rather than act on a guess,
   * and a passive matter is how "ask" looks before the user answers.
   */
  kind: 'reminder' | 'list'
  timePrecision: TimePrecision
  confidence: ConfidenceBucket
  notes?: string
  /** Source says this is finished. Completed items are not resurrected as open. */
  completed?: boolean
  /**
   * The source will already alert the user at the deadline itself — a calendar
   * event carrying its own `reminders.overrides`, for instance.
   *
   * When set, Kitto drops its own at-due nudge and keeps only the lead-time
   * one. smart-reminder-conflict-spec.md §1 names notification pile-up as the
   * problem it exists to solve, so an integration that adds a second alert ten
   * minutes before every appointment would have the product failing its own
   * spec on day one. The lead-time nudge is kept because it is genuinely
   * additive — Google says "in 10 minutes", Kitto says "tomorrow, bring the
   * referral letter".
   */
  sourceHasOwnAlerts?: boolean
}

export interface ReconcileOutcome {
  created: boolean
  updated: boolean
  /** Set when nothing happened and why, so callers can report honestly. */
  skipped?: 'user_deleted'
}

// Under a minute apart is the same moment — sources round differently and a
// re-plan on every poll would clear firedAt and re-fire nudges the user has
// already had.
const SAME_MOMENT_MS = 60_000

export async function reconcileExternalMatter(
  input: ExternalMatterInput,
  now: Date = new Date(),
): Promise<ReconcileOutcome> {
  const existing = await Task.findOne({
    userId: input.userId,
    externalSource: input.externalSource,
    externalId: input.externalId,
  })

  // Rule 2.
  if (existing?.deletedAt) return { created: false, updated: false, skipped: 'user_deleted' }

  if (!existing) {
    // Nothing to create for something that arrived already finished — importing
    // a year of completed items as fresh matters would bury the real list.
    if (input.completed) return { created: false, updated: false }

    const task = await Task.create({
      userId: input.userId,
      title: input.title,
      domain: input.domain,
      kind: input.kind,
      status: 'open',
      priority: 'normal',
      subtasks: [],
      tags: [],
      dueAt: input.dueAt,
      notes: input.notes,
      externalSource: input.externalSource,
      externalId: input.externalId,
      timePrecision: input.timePrecision,
      confidence: input.confidence,
      reminders: [],
      rescheduleCount: 0,
    })
    await setRulesReminders(task, now)
    await dropDuplicateDueNudge(task, input)
    return { created: true, updated: false }
  }

  // Completion propagates in one direction only: the source can close a matter,
  // never reopen one. A user who ticked something off in Kitto must not have it
  // un-ticked by a stale row upstream.
  if (input.completed && existing.status !== 'done') {
    existing.status = 'done'
    existing.completedAt = now
    await existing.save()
    return { created: false, updated: true }
  }

  // Rule 3.
  const movedBy = existing.dueAt
    ? Math.abs(existing.dueAt.getTime() - input.dueAt.getTime())
    : Number.POSITIVE_INFINITY
  if (movedBy <= SAME_MOMENT_MS && existing.kind === input.kind) {
    return { created: false, updated: false }
  }

  existing.dueAt = input.dueAt
  existing.kind = input.kind
  existing.timePrecision = input.timePrecision
  existing.confidence = input.confidence
  await existing.save()
  await setRulesReminders(existing, now)
  await dropDuplicateDueNudge(existing, input)
  return { created: false, updated: true }
}

// setRulesReminders always writes an at-due entry, which is right for a matter
// Kitto owns and wrong for one the source already alerts on. Stripping it after
// the fact keeps the lead-time logic in exactly one place rather than teaching
// the planner about integrations.
async function dropDuplicateDueNudge(
  task: TaskDoc,
  input: ExternalMatterInput,
): Promise<void> {
  if (!input.sourceHasOwnAlerts) return
  const kept = task.reminders.filter((entry) => entry.kind !== 'due')
  if (kept.length === task.reminders.length) return
  task.set(
    'reminders',
    kept.map((entry) => ({ at: entry.at, kind: entry.kind, firedAt: entry.firedAt })),
  )
  await task.save()
}
