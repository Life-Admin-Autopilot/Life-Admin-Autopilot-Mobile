import { env } from '../env'
import { logger } from '../logger'
import { Clarification } from '../models/Clarification'
import { Notification } from '../models/Notification'
import { Task, type ReminderEntry, type TaskDoc } from '../models/Task'

// Background scheduler that fires due reminders into the Notification feed.
// Mirrors the voice worker (server/src/lib/voiceNoteTranscriber.ts): a polled
// interval, but here the double-send guard is per-reminder — each reminder
// entry is atomically claimed (firedAt set) before its Notification is written,
// so a slow/overlapping tick can never send twice. Reminders are coarse, so a
// 30s poll is plenty.

const POLL_MS = 30_000
const BATCH = 100
// How long a held item may sit unresolved before we nudge, and the min gap
// between nudges so the same backlog doesn't ping repeatedly.
const UNCERTAINTY_STALE_MS = 6 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function reminderBody(task: TaskDoc, r: ReminderEntry): string {
  if (!task.dueAt) return 'Reminder'
  if (r.kind === 'lead') return `Coming up — due ${shortDate(task.dueAt)}.`
  return `Due ${shortDate(task.dueAt)}.`
}

async function runOnce(): Promise<void> {
  const now = new Date()
  // Candidate tasks: not done, holding at least one un-fired reminder due now.
  const tasks = await Task.find({
    status: { $in: ['open', 'snoozed'] },
    reminders: { $elemMatch: { firedAt: null, at: { $lte: now } } },
  })
    .limit(BATCH)
    .exec()

  for (const task of tasks) {
    const due = task.reminders.filter((r) => !r.firedAt && r.at.getTime() <= now.getTime())
    for (const r of due) {
      // Atomically claim THIS reminder entry (firedAt:null → now). If another
      // tick already claimed it, `claimed` is null and we skip — no double-send.
      const claimed = await Task.findOneAndUpdate(
        { _id: task._id, reminders: { $elemMatch: { at: r.at, firedAt: null } } },
        { $set: { 'reminders.$.firedAt': now } },
      ).exec()
      if (!claimed) continue
      await Notification.create({
        userId: task.userId,
        kind: 'reminder',
        taskId: task._id,
        title: task.title,
        body: reminderBody(task, r),
      })
    }
  }

  await nudgeStaleUncertainties(now)
}

// Nudge users whose held uncertainties have sat too long — one aggregate
// notification per user, rate-limited to one per stale window so a standing
// backlog doesn't ping every tick (deduped on a recent uncertainty notification,
// read or not).
async function nudgeStaleUncertainties(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - UNCERTAINTY_STALE_MS)
  const userIds = await Clarification.distinct('userId', {
    status: 'open',
    createdAt: { $lte: cutoff },
  })
  for (const userId of userIds) {
    const recentlyNudged = await Notification.exists({
      userId,
      kind: 'uncertainty',
      createdAt: { $gt: cutoff },
    })
    if (recentlyNudged) continue
    const count = await Clarification.countDocuments({ userId, status: 'open' })
    if (count === 0) continue
    await Notification.create({
      userId,
      kind: 'uncertainty',
      title: `${count} ${count === 1 ? 'matter needs' : 'matters need'} your input`,
      body: 'Pick an answer or type your own.',
    })
  }
}

export function startReminderWorker(): void {
  if (timer) return
  if (env().NODE_ENV === 'test') return
  timer = setInterval(() => {
    void runOnce().catch((err: unknown) => logger.error({ err }, 'reminderWorker:tick-failed'))
  }, POLL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('reminderWorker:started')
}

export function stopReminderWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
