import { Router } from 'express'

import { asyncHandler, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { Task, notDeleted } from '../models/Task'

export const meRemindersRouter = Router()

// How far ahead the client is given reminders to schedule on-device.
// Generous on purpose: local notifications can only be scheduled while the app
// is open, so the window has to cover a plausible gap between visits.
const HORIZON_DAYS = 30
// iOS caps an app at 64 pending local notifications and silently drops the rest,
// so send the soonest ones and let the next sync top up.
const MAX_REMINDERS = 60

// GET /me/reminders/upcoming — the reminders the DEVICE should schedule.
//
// Reminders are planned server-side (planReminders) but nothing could deliver
// them: the server only ever wrote a Notification row, which is invisible
// unless the app is already open. On a free Apple developer team there is no
// APNs, so the server cannot wake the app either. The workable path is to hand
// the schedule to the client and let iOS fire it locally — no push
// certificate, no paid membership, works with the app closed.
meRemindersRouter.get(
  '/me/reminders/upcoming',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const now = new Date()
    const horizon = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)

    const tasks = await Task.find({
      userId: auth.sub,
      ...notDeleted(),
      status: { $in: ['open', 'snoozed'] },
      reminders: { $elemMatch: { firedAt: null, at: { $gt: now, $lte: horizon } } },
    })
      .sort({ dueAt: 1 })
      .limit(MAX_REMINDERS)

    // Flatten to one entry per (task, reminder). The id is deterministic so a
    // re-sync replaces the same OS notification instead of stacking duplicates.
    const reminders = tasks
      .flatMap((task) =>
        task.reminders
          .filter((r) => !r.firedAt && r.at > now && r.at <= horizon)
          .map((r) => ({
            id: `${String(task._id)}:${r.at.getTime()}`,
            taskId: String(task._id),
            title: task.title,
            at: r.at.toISOString(),
            kind: r.kind,
            dueAt: task.dueAt?.toISOString() ?? null,
          })),
      )
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, MAX_REMINDERS)

    res.status(200).json({ reminders })
  }),
)
