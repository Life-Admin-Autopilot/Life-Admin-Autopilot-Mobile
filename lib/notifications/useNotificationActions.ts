'use client'

import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import { REMINDER_ACTIONS, registerNotificationActions } from './actionTypes'
import { requestNotificationPermission, syncReminders } from './syncReminders'

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
