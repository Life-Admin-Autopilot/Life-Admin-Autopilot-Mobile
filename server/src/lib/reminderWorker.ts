import { env } from '../env'
import { logger } from '../logger'
import { Clarification } from '../models/Clarification'
import { Notification } from '../models/Notification'
import { Task, notDeleted, type ReminderEntry, type TaskDoc } from '../models/Task'
import { User } from '../models/User'

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
// How long an unanswered question stands before it settles on the AI's guess.
// Deliberately generous — a week, matching the Skip window — because settling
// is irreversible from the question's side and the user may simply have been
// away. The old 6h value paced a recurring NAG, which is a different job with
// very different stakes.
const CLARIFICATION_SETTLE_MS = 7 * 24 * 60 * 60 * 1000

let timer: ReturnType<typeof setInterval> | null = null

// The zone matters because the notification NAMES a day. A matter due at
// 2025-03-05T01:00Z is "Mar 5" in UTC but "Mar 4" for a user in New York, and a
// reminder that names the wrong day is worse than one that names none —
// see the trust contract in AGENTS.md. Falls back to UTC when the user has
// never set one (the field is optional by design).
function shortDate(d: Date, timeZone: string): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone })
}

function reminderBody(task: TaskDoc, r: ReminderEntry, timeZone: string): string {
  if (!task.dueAt) return 'Reminder'
  if (r.kind === 'lead') return `Coming up — due ${shortDate(task.dueAt, timeZone)}.`
  return `Due ${shortDate(task.dueAt, timeZone)}.`
}

// One query for the whole batch rather than a User lookup per task: a tick can
// carry 100 tasks and they cluster onto far fewer users.
async function timezonesFor(userIds: readonly unknown[]): Promise<Map<string, string>> {
  const rows = await User.find({ _id: { $in: userIds } }, { timezone: 1 }).lean()
  const byId = new Map<string, string>()
  for (const row of rows) {
    byId.set(String(row._id), row.timezone ?? 'UTC')
  }
  return byId
}

async function runOnce(): Promise<void> {
  const now = new Date()
  // Candidate tasks: live, not done, holding at least one un-fired reminder due
  // now. The soft-delete guard matters here more than anywhere — firing a
  // notification for a matter the user just deleted is the worst possible way
  // to learn that delete didn't stick.
  const tasks = await Task.find({
    ...notDeleted(),
    status: { $in: ['open', 'snoozed'] },
    reminders: { $elemMatch: { firedAt: null, at: { $lte: now } } },
  })
    .limit(BATCH)
    .exec()

  const zones = await timezonesFor([...new Set(tasks.map((t) => String(t.userId)))])

  for (const task of tasks) {
    const timeZone = zones.get(String(task.userId)) ?? 'UTC'
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
        body: reminderBody(task, r, timeZone),
      })
    }
  }

  await settleStaleClarifications(now)
}

// A question the user never answered SETTLES on the AI's guess — it does not
// nag.
//
// This used to send a recurring "N matters need your input" notification for as
// long as the backlog stood. That is the pattern ADHD-focused design writing
// names as actively harmful: an unresolved counter the user cannot clear turns
// into guilt, and re-surfacing it on a timer is the shame mechanism, not a
// reminder. The task now already exists with the guess applied, so letting the
// question expire quietly costs nothing — the user can still edit the task any
// time, and a high-cost item's reminder simply stays withheld.
async function settleStaleClarifications(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - CLARIFICATION_SETTLE_MS)
  await Clarification.updateMany(
    { status: 'open', createdAt: { $lte: cutoff } },
    { $set: { status: 'dropped', resolvedAt: now, answer: 'Settled on the original guess.' } },
  )
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
