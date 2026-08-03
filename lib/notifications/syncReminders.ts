import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

import { api } from '@/lib/api/client'
import { REMINDER_ACTION_TYPE } from './actionTypes'
import { staticMessages } from '@/lib/i18n/staticMessages'

// Push the server's reminder schedule onto the DEVICE.
//
// Reminders are planned server-side, but the server has no way to deliver them:
// it can only write a Notification row, which the user sees only if the app is
// already open, and on a free Apple team there is no APNs to wake the app with.
// So the device holds the schedule instead. iOS fires these with the app closed,
// with no certificate and no paid membership.
//
// The catch that shapes everything here: local notifications can only be
// SCHEDULED while the app is running. So this runs on launch and on resume, and
// re-syncs the whole window each time rather than trying to diff.

interface UpcomingReminder {
  id: string
  taskId: string
  title: string
  at: string
  kind: string
  dueAt: string | null
}

// iOS keys pending notifications by a 32-bit int, so the server's
// "<taskId>:<epoch>" string has to be folded down. A stable hash means a
// re-sync REPLACES the same pending notification instead of stacking a
// duplicate every time the app is opened.
function stableId(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export async function syncReminders(): Promise<{ scheduled: number } | null> {
  if (!Capacitor.isNativePlatform()) return null

  const permission = await LocalNotifications.checkPermissions()
  if (permission.display !== 'granted') return null

  const { reminders } = await api<{ reminders: UpcomingReminder[] }>('/me/reminders/upcoming')

  // Clear what we scheduled before re-scheduling. Without this, a reminder the
  // user has since completed or rescheduled would still fire from the device's
  // own copy — the schedule on the phone is a cache, and a stale cache here
  // means being nagged about something already done.
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({ notifications: pending.notifications })
  }

  const copy = staticMessages().notifications
  const now = Date.now()
  const due = reminders.filter((r) => new Date(r.at).getTime() > now)
  if (due.length === 0) return { scheduled: 0 }

  await LocalNotifications.schedule({
    notifications: due.map((r) => ({
      id: stableId(r.id),
      title: r.title,
      body: r.kind === 'lead' ? copy.bodyLead : copy.bodyDue,
      schedule: { at: new Date(r.at), allowWhileIdle: true },
      actionTypeId: REMINDER_ACTION_TYPE,
      extra: { taskId: r.taskId },
    })),
  })

  return { scheduled: due.length }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  const current = await LocalNotifications.checkPermissions()
  if (current.display === 'granted') return true
  // 'denied' is terminal until the user changes it in Settings — asking again
  // is a no-op the OS won't even surface, so don't pretend otherwise.
  if (current.display === 'denied') return false
  const asked = await LocalNotifications.requestPermissions()
  return asked.display === 'granted'
}
