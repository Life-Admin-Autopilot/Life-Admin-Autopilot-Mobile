import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'

import { api } from '@/lib/api/client'

// Hand this device's push address to the server.
//
// The server plans reminders and, since ReminderTick learned to deliver them,
// can now send one the moment it fires — but it cannot reach a phone directly.
// Only Google and Apple hold a standing connection to every device, so the
// device asks them for an address (a token), and this posts that token to
// /api/devices/register against the signed-in account.
//
// This is the SECOND delivery channel, not a replacement. See syncReminders for
// the local one and why they must not both fire.

export type PushRegistration =
  | { status: 'active'; token: string }
  /** No native layer, permission refused, or the platform could not issue one. */
  | { status: 'unavailable'; reason: string }

/** Resolves once the token arrives, or when the platform says it cannot issue one. */
function awaitToken(): Promise<PushRegistration> {
  return new Promise((resolve) => {
    let settled = false

    const finish = (result: PushRegistration): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    void PushNotifications.addListener('registration', (token) => {
      finish({ status: 'active', token: token.value })
    })

    void PushNotifications.addListener('registrationError', (error) => {
      // The commonest cause on iOS is no APNs key uploaded to Firebase, which is
      // a setup gap rather than a code fault — so it is reported, not thrown.
      finish({ status: 'unavailable', reason: String(error?.error ?? 'registration failed') })
    })

    void PushNotifications.register()

    // A platform that never answers must not leave the caller hanging, because
    // the local-notification fallback is waiting on this decision.
    setTimeout(() => finish({ status: 'unavailable', reason: 'timed out' }), 10_000)
  })
}

/**
 * Ask for permission, get the token, register it. Safe to call repeatedly —
 * the server upserts on the token, so a re-register refreshes lastSeenAt rather
 * than stacking rows.
 */
export async function registerPushDevice(): Promise<PushRegistration> {
  if (!Capacitor.isNativePlatform()) {
    // A browser CAN receive web push, but only through a service worker and a
    // VAPID key — a different client setup entirely. Nothing here works in one.
    return { status: 'unavailable', reason: 'not a native platform' }
  }

  try {
    let permission = await PushNotifications.checkPermissions()
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions()
    }

    if (permission.receive !== 'granted') {
      return { status: 'unavailable', reason: 'permission not granted' }
    }

    const registration = await awaitToken()
    if (registration.status !== 'active') return registration

    await api('/api/devices/register', {
      method: 'POST',
      body: {
        token: registration.token,
        // The server's enum is Android | Ios, and its JSON binder accepts the
        // name. Capacitor reports 'android' | 'ios' | 'web', and 'web' cannot
        // reach here because of the native check above.
        platform: Capacitor.getPlatform() === 'ios' ? 'Ios' : 'Android',
      },
    })

    return registration
  } catch (error) {
    // Never let this break sign-in. Without push the app still schedules its
    // reminders locally, which is exactly the state it shipped in.
    return { status: 'unavailable', reason: String(error) }
  }
}

/** Called on sign-out so a handed-down phone stops receiving the old account's reminders. */
export async function unregisterPushDevice(token: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return

  try {
    await api('/api/devices', { method: 'DELETE', body: { token } })
  } catch {
    // The row deactivates on the next failed send anyway; a failure here is not
    // worth blocking a sign-out over.
  }
}
