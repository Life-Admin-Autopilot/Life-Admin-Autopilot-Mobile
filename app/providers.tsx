'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { bootSessionStore } from '@/lib/auth/sessionStore'
import { createQueryClient } from '@/queries/client'

// App-root providers. Created once on the client (useState initializer) so the
// QueryClient survives re-renders. Hydrates the auth session from storage on
// mount. Toaster is mounted here so lib/toast.ts has a host everywhere.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    bootSessionStore()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
}
