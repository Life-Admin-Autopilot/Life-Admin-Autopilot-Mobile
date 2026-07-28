import { Types } from 'mongoose'

import { PENDING, VOLUMES } from '../config'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'
import type { TaskSeed } from './taskFactory'

// The bell feed. Three producers in the real app — a reminder firing, held
// items going stale, a scan finishing — so all three appear here.
//
// The feed is built BACKWARDS from the reminders that actually fired, rather
// than invented: a notification whose task has no matching fired reminder is
// a row the user can tap into a contradiction.

interface FiredReminder {
  task: TaskSeed
  firedAt: Date
}

function collectFired(tasks: TaskSeed[]): FiredReminder[] {
  const out: FiredReminder[] = []
  for (const task of tasks) {
    if (task.deletedAt) continue
    const entries = (task.reminders as { at: Date; firedAt?: Date }[] | undefined) ?? []
    for (const entry of entries) {
      if (entry.firedAt) out.push({ task, firedAt: entry.firedAt })
    }
  }
  return out.sort((a, b) => a.firedAt.getTime() - b.firedAt.getTime())
}

export function buildNotifications(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  tasks: TaskSeed[]
  documents: SeedDoc[]
  clarifications: SeedDoc[]
}): SeedDoc[] {
  const { rng, userId, now, tasks, documents, clarifications } = args

  const fired = collectFired(tasks)
  // Newest first, then trimmed — the feed shows recent activity, and three
  // years of every reminder ever would be a scroll to nowhere.
  const recent = fired.slice(-Math.floor(VOLUMES.notifications * 0.7))

  const out: SeedDoc[] = recent.map(({ task, firedAt }) => ({
    _id: new Types.ObjectId(),
    userId,
    kind: 'reminder',
    title: task.title,
    body: task.dueAt
      ? `Due ${task.dueAt.toLocaleString('en-GB', { day: 'numeric', month: 'short' })}.`
      : undefined,
    taskId: task._id,
    createdAt: firedAt,
    updatedAt: firedAt,
  }))

  // A scan finished processing.
  for (const doc of documents) {
    if (out.length >= VOLUMES.notifications * 0.9) break
    if (!rng.chance(0.55)) continue
    const at = doc.notifiedAt as Date | undefined
    if (!at) continue
    out.push({
      _id: new Types.ObjectId(),
      userId,
      kind: 'document_scan',
      title: `${String(doc.documentTitle)} is ready`,
      body: `${(doc.candidates as unknown[]).length} thing(s) to confirm.`,
      documentId: doc._id,
      createdAt: at,
      updatedAt: at,
    })
  }

  // Held items went stale.
  for (const clar of clarifications) {
    if (out.length >= VOLUMES.notifications) break
    if (clar.status !== 'resolved' || !rng.chance(0.12)) continue
    const at = new Date((clar.createdAt as Date).getTime() + 2 * 86_400_000)
    if (at > now) continue
    out.push({
      _id: new Types.ObjectId(),
      userId,
      kind: 'uncertainty',
      title: 'A question is still waiting',
      body: String(clar.question),
      clarificationId: clar._id,
      createdAt: at,
      updatedAt: at,
    })
  }

  // Read state is assigned by recency, not at random: someone who opens the
  // app daily has read everything except the last handful.
  const sorted = out.sort(
    (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime(),
  )
  return sorted.map((row, i) => {
    if (i < PENDING.unreadNotifications) return row
    const created = row.createdAt as Date
    return {
      ...row,
      readAt: new Date(
        Math.min(created.getTime() + rng.int(120_000, 6 * 3_600_000), now.getTime()),
      ),
    }
  })
}
