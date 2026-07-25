'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { AppTabBar } from '@/components/layout/AppTabBar'
import { PhoneFrame } from '@/components/layout/PhoneFrame'
import { ChatIsland } from '@/components/chat/ChatIsland'
import { VoiceIsland } from '@/components/voice/VoiceIsland'
import { bootSessionStore } from '@/lib/auth/sessionStore'
import { createQueryClient } from '@/queries/client'

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
      <QueryClientProvider client={queryClient}>
        <PhoneFrame>
          {children}
          <AppTabBar />
          <ChatIsland />
          <VoiceIsland />
          <Toaster />
        </PhoneFrame>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
