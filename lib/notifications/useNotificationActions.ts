'use client'

import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import { REMINDER_ACTION_TYPE, REMINDER_ACTIONS, registerNotificationActions } from './actionTypes'
import { registerPushDevice } from './registerPushDevice'
import { requestNotificationPermission, setServerDelivery, syncReminders } from './syncReminders'

// Answering a reminder from the Lock Screen, without opening the app.
//
// Neither action is registered as `foreground`, so iOS wakes the web layer in
// the background, fires this listener, and the app never comes to the front.
// That is the "answer without opening it" behaviour — reached with plain
// notification actions rather than widgets, Live Activities, or App Intents,
// none of which can be triggered by our server on a free Apple team anyway.

const LATER_TODAY_HOUR = 18

function laterToday(): string {
  const at = new Date()
  at.setHours(LATER_TODAY_HOUR, 0, 0, 0)
  // Already past 18:00 → push to the same hour tomorrow rather than scheduling
  // something in the past, which would fire immediately.
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
  return at.toISOString()
}

export function useNotificationActions(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false
    const listeners: { remove: () => Promise<void> }[] = []

    const start = async () => {
      await registerNotificationActions()
      const granted = await requestNotificationPermission()
      if (cancelled || !granted) return

      // Offer this device to the server first. Its answer decides whether the
      // local schedule below is the delivery mechanism or dead weight that would
      // buzz the user a second time for every reminder.
      const push = await registerPushDevice()
      if (cancelled) return
      setServerDelivery(push.status === 'active')

      const handle = await LocalNotifications.addListener(
        'localNotificationActionPerformed',
        (event) => {
          const taskId = event.notification.extra?.taskId as string | undefined
          if (!taskId) return

          const body =
            event.actionId === REMINDER_ACTIONS.done
              ? { status: 'done' }
              : event.actionId === REMINDER_ACTIONS.snooze
                ? { status: 'snoozed', snoozedUntil: laterToday() }
                : null
          if (!body) return

          void api(`/me/tasks/${taskId}`, { method: 'PATCH', body })
            .then(() => {
              void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
              // The device's schedule is now stale for this task — re-sync so
              // a completed item can't still fire from the phone's own copy.
              return syncReminders()
            })
            .catch(() => {
              /* Best effort: the app may be backgrounded with no network. The
                 next foreground sync reconciles from the server either way. */
            })
        },
      )
      if (cancelled) {
        void handle.remove()
        return
      }
      listeners.push(handle)

      // A push that lands while the app is IN THE FOREGROUND is handed to the
      // app instead of being posted to the tray — that is Android's behaviour,
      // not a bug — and until this existed nothing was subscribed, so logcat
      // read "No listeners found for event pushNotificationReceived" and the
      // reminder was simply lost.
      //
      // There is no second chance for it either: setServerDelivery(true) above
      // has already switched local scheduling off so the two channels cannot
      // double-buzz, which leaves the foreground case with no delivery path at
      // all. Re-posting it locally is that path.
      const pushHandle = await PushNotifications.addListener(
        'pushNotificationReceived',
        (notification) => {
          // No `schedule` field: LocalNotifications posts it immediately.
          // REMINDER_ACTION_TYPE is reused so Done / Not today behave exactly as
          // they do on a backgrounded reminder — the listener above handles both.
          void LocalNotifications.schedule({
            notifications: [
              {
                // Notification ids are a 32-bit int. Seconds since epoch stays
                // inside that and cannot collide with stableId(), which hashes
                // a "<taskId>:<epoch>" string rather than counting time.
                id: Math.floor(Date.now() / 1000) % 2_147_483_647,
                title: notification.title ?? '',
                body: notification.body ?? '',
                // The same drawable the FCM path gets from the
                // default_notification_icon meta-data that
                // scripts/patch-android-manifest.mjs writes. Without it Android
                // falls back to the launcher icon and redraws it from its alpha
                // alone, so the two channels show visibly different marks for
                // what is the same reminder.
                smallIcon: 'ic_stat_kitto',
                actionTypeId: REMINDER_ACTION_TYPE,
                extra: { taskId: notification.data?.taskId },
              },
            ],
          })

          // The matter it refers to just changed state server-side, and the
          // open app is showing the version from before the reminder fired.
          void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
        },
      )
      if (cancelled) {
        void pushHandle.remove()
        return
      }
      listeners.push(pushHandle)

      await syncReminders()
    }

    // The device can only be handed a schedule while the app is RUNNING, so
    // every return to the foreground is the chance to top it up and drop
    // anything completed elsewhere. visibilitychange rather than the App plugin
    // — it needs no extra dependency and fires for the same transitions.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncReminders()
    }
    document.addEventListener('visibilitychange', onVisible)

    void start()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      for (const l of listeners) void l.remove()
    }
  }, [queryClient])
}
