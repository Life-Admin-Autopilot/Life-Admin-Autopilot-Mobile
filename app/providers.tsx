'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { FpsMeter } from '@/components/dev/FpsMeter'
import { AppTabBar } from '@/components/layout/AppTabBar'
import { PhoneFrame } from '@/components/layout/PhoneFrame'
import { ChatIsland } from '@/components/chat/ChatIsland'
import { LocaleProvider } from '@/components/i18n/LocaleProvider'
import { VoiceIsland } from '@/components/voice/VoiceIsland'
import { bootSessionStore, useSessionStore } from '@/lib/auth/sessionStore'
import { env } from '@/lib/env'
import { adoptUserLocale } from '@/lib/i18n/localeStore'
import { useNotificationActions } from '@/lib/notifications/useNotificationActions'
import { createQueryClient } from '@/queries/client'

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
function AdoptAccountLocale() {
  const accountLocale = useSessionStore((s) => s.user?.locale ?? null)

  useEffect(() => {
    adoptUserLocale(accountLocale)
  }, [accountLocale])

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
          <AdoptAccountLocale />
          <PhoneFrame>
            {children}
            <AppTabBar />
            <ChatIsland />
            <VoiceIsland />
            <Toaster />
            {env.showFps ? <FpsMeter /> : null}
          </PhoneFrame>
        </QueryClientProvider>
      </LocaleProvider>
    </ThemeProvider>
  )
}
