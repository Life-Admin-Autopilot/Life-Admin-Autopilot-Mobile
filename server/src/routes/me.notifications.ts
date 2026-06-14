import { Router } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'

import { asyncHandler, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { Notification } from '../models/Notification'

export const meNotificationsRouter = Router()

// The in-app notification feed (reminders + uncertainty nudges) + unread count.
meNotificationsRouter.get(
  '/me/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ userId: auth.sub }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({ userId: auth.sub, readAt: null }),
    ])
    res.status(200).json({
      notifications: notifications.map((n) => n.toJSON()),
      unreadCount,
    })
  }),
)

const ReadSchema = z.object({ ids: z.array(z.string()).max(100).optional() })

// Mark notifications read — specific `ids`, or all unread when omitted.
meNotificationsRouter.post(
  '/me/notifications/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const { ids } = ReadSchema.parse(req.body ?? {})
    const filter: Record<string, unknown> = { userId: auth.sub, readAt: null }
    if (ids && ids.length > 0) {
      filter._id = { $in: ids.filter((id) => Types.ObjectId.isValid(id)) }
    }
    await Notification.updateMany(filter, { $set: { readAt: new Date() } })
    const unreadCount = await Notification.countDocuments({ userId: auth.sub, readAt: null })
    res.status(200).json({ ok: true, unreadCount })
  }),
)
