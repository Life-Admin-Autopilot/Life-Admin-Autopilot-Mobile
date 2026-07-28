import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

// The buttons that appear ON the notification itself.
//
// registerActionTypes builds real UNNotificationCategory / UNNotificationAction
// objects under the hood, so these are the same system-rendered buttons you get
// from a native app — answerable from the Lock Screen. Two per notification is
// the practical limit: iOS shows only the first two in the compact banner and
// hides the rest behind an expand, so the most likely answer goes first.
//
// No APNs, no .p8 key, no aps-environment entitlement, and no paid Apple
// Developer membership is involved — these fire from a schedule held on the
// device. That is the whole reason this works on a free personal team.

export const REMINDER_ACTION_TYPE = 'kitto.reminder'

export const REMINDER_ACTIONS = {
  done: 'kitto.reminder.done',
  snooze: 'kitto.reminder.snooze',
} as const

export async function registerNotificationActions(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: REMINDER_ACTION_TYPE,
        actions: [
          // Neither is `foreground`, so tapping them does NOT open the app —
          // iOS wakes it in the background to run the handler and that's it.
          { id: REMINDER_ACTIONS.done, title: 'Done' },
          { id: REMINDER_ACTIONS.snooze, title: 'Later today' },
        ],
      },
    ],
  })
}
