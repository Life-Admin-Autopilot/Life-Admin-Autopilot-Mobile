'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { AppTabBar } from '@/components/layout/AppTabBar'
import { PageTransition } from '@/components/layout/PageTransition'
import { PhoneFrame } from '@/components/layout/PhoneFrame'
import { ChatIsland } from '@/components/chat/ChatIsland'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { VoiceIsland } from '@/components/voice/VoiceIsland'
import { bootSessionStore, selectStatus, useSessionStore } from '@/lib/auth/sessionStore'
import { deviceTimeZone } from '@/lib/i18n/dateFormat'
import { adoptUserLocale, deviceLocale } from '@/lib/i18n/localeStore'
import { useNotificationActions } from '@/lib/notifications/useNotificationActions'
import { createQueryClient } from '@/queries/client'
import { useUpdateProfile } from '@/queries/profile'

// Must live INSIDE QueryClientProvider — it invalidates task queries when a
// reminder is answered from the Lock Screen.
function NativeNotifications() {
  useNotificationActions()
  return null
}

// Adopts `User.locale` once the session resolves, so a language chosen on
// another device carries over. Reads the session store rather than a query
// because bootSessionStore already fetches /auth/me — a second request would
// tell us nothing new. Deliberately one-way: it never writes back, so it cannot
// fight the picker in Settings.
//
// Skipped when the account's language was itself read off a device. The account
// stores the effective language either way (the server writes prose with no
// device in reach), so without this check an Arabic phone's setting would follow
// the account onto an English one — which is the opposite of what the person
// asked for when they chose "follow the device".
//
// The one thing it does write back is drift, and only for a device-following
// account: someone who switches their phone to Arabic gets an Arabic app
// immediately, and this is what stops their digest and their scans staying
// English behind it. It still cannot fight the picker, because an explicit choice
// clears localeFollowsDevice and this branch never runs for it.
function SyncAccountLocale() {
  const followsDevice = useSessionStore((s) => s.user?.localeFollowsDevice === true)
  const accountLocale = useSessionStore((s) => s.user?.locale ?? null)
  const signedIn = useSessionStore((s) => s.user != null)
  const update = useUpdateProfile()

  useEffect(() => {
    adoptUserLocale(followsDevice ? null : accountLocale)
  }, [followsDevice, accountLocale])

  useEffect(() => {
    if (!signedIn || !followsDevice) return
    const device = deviceLocale()
    if (accountLocale === device) return
    // Converges: the write lands in the session store, this runs again, and the
    // comparison stops it. A failure just leaves the old value to retry later.
    update.mutate({ locale: device, localeFollowsDevice: true })
    // `update` is a stable mutation handle; listing it would re-fire on every
    // render of its internal state rather than on a real locale change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, followsDevice, accountLocale])

  return null
}

/**
 * Keep the account's timezone on the device's, until the user picks one.
 *
 * The client never needed this — every screen formats against
 * `deviceTimeZone()`, and Profile even renders `user.timezone ?? detectedZone`,
 * so the row reads "Africa/Cairo" whether or not anything was ever saved. That
 * fallback is why nobody noticed the account field was empty on all 33 of them.
 *
 * The SERVER has no device to fall back to. A background worker resolving a
 * date-only Google Task, or writing a digest at 7am local, has nothing to
 * resolve "local" against — so the Google sync refuses outright with
 * "Set your timezone", and refused for every user who ever connected an account.
 *
 * This used to trigger on `timezone` being EMPTY, and that test stopped working
 * the moment the server started provisioning `Africa/Cairo` at signup: the field
 * is never blank now, so device detection would have gone quietly dead and left
 * every non-Egyptian account sitting on the default. It keys off
 * `timezoneFollowsDevice` instead, exactly as SyncAccountLocale keys off
 * `localeFollowsDevice`. An absent flag is a pre-flag account and counts as
 * following, which reproduces the old fill-a-blank behaviour for those.
 *
 * It cannot fight the picker: choosing a zone in Profile clears the flag, and
 * someone who deliberately set Europe/Berlin while travelling must not have it
 * pulled back to wherever the phone is.
 */
function SyncAccountTimezone() {
  const signedIn = useSessionStore((s) => s.user != null)
  const followsDevice = useSessionStore((s) => s.user?.timezoneFollowsDevice !== false)
  const timezone = useSessionStore((s) => s.user?.timezone ?? null)
  const update = useUpdateProfile()

  useEffect(() => {
    if (!signedIn || !followsDevice) return
    const device = deviceTimeZone()
    if (!device || device === timezone) return
    // Converges: the write lands in the session store, this runs again, and the
    // equality check stops it. A failure leaves the old value to retry later.
    update.mutate({ timezone: device, timezoneFollowsDevice: true })
    // `update` is a stable mutation handle; listing it would re-fire on its own
    // internal state changes rather than on a real timezone change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, followsDevice, timezone])

  return null
}

// Routes reachable without a session. Everything else requires one.
const PUBLIC_ROUTES = ['/welcome', '/sign-in', '/sign-up']

/**
 * Send the user to sign-in when the session ends — from wherever they are.
 *
 * `app/page.tsx` already did this, but only for `/`. A session that expired
 * while the user was on /dashboard or /matters left them sitting on a screen
 * whose every query answered 401, with an error toast and no way out but a
 * manual reload. Guarding at the shell means the redirect follows the session,
 * not the route.
 *
 * `status === 'loading'` is deliberately excluded: that is the state during boot
 * hydration, and redirecting on it would bounce every cold start to /welcome
 * before the stored tokens have even been read.
 */
function RedirectOnSignOut() {
  const status = useSessionStore(selectStatus)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status !== 'unauthenticated') return
    if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) return
    router.replace('/welcome')
  }, [status, pathname, router])

  return null
}

// App-root providers. Created once on the client (useState initializer) so the
// QueryClient survives re-renders. Hydrates the auth session from storage on
// mount. Toaster is mounted here so lib/toast.ts has a host everywhere.
// ThemeProvider toggles the `dark` class on <html>; class-based (not
// data-attribute) because globals.css defines dark tokens via `.dark`.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    bootSessionStore()
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <LocaleProvider>
        <QueryClientProvider client={queryClient}>
          <NativeNotifications />
          <SyncAccountLocale />
          <SyncAccountTimezone />
          <RedirectOnSignOut />
          <PhoneFrame>
            {/* Only the routed page animates. The tab bar, the islands and the
                toaster are siblings, not children, so they stay mounted and
                still across every navigation. PageTransition must be rendered
                from here — a component that persists across navigation — rather
                than from app/template.tsx, which is re-created on each one and
                so can never hold an exiting page. */}
            <PageTransition>{children}</PageTransition>
            <AppTabBar />
            <ChatIsland />
            <VoiceIsland />
            <Toaster />
          </PhoneFrame>
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
