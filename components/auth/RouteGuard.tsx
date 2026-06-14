'use client'

import { AppSplash } from '@/components/auth/AppSplash'
import { useAuthGate, type Guard } from '@/lib/auth/useAuthGate'

// Wraps a guarded route's content — renders the splash while the session
// resolves / a redirect is in flight, then the children once allowed.
export function RouteGuard({ guard, children }: { guard: Guard; children: React.ReactNode }) {
  const { ready } = useAuthGate(guard)
  if (!ready) return <AppSplash />
  return <>{children}</>
}
