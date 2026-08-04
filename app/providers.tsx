'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { AppTabBar } from '@/components/layout/AppTabBar'
import { PageTransition } from '@/components/layout/PageTransition'
import { PhoneFrame } from '@/components/layout/PhoneFrame'
import { ChatIsland } from '@/components/chat/ChatIsland'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { VoiceIsland } from '@/components/voice/VoiceIsland'
import { bootSessionStore, useSessionStore } from '@/lib/auth/sessionStore'
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
