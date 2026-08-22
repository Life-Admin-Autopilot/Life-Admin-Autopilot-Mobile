'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { SIGNED_OUT_ROUTE } from '@/lib/appRoutes'
import { useSessionStore, selectStatus, selectUser } from '@/lib/auth/sessionStore'

// Client-side route gating for the static-export SPA. Each guard declares what
// the route requires; the hook redirects when the session doesn't match and
// exposes `ready` so the page only renders its content once it's allowed.
//   guest      → logged-out screens (welcome, sign-in/up)
//   onboarding → authenticated but not yet onboarded
//   app        → authenticated AND onboarded (the main app)
export type Guard = 'guest' | 'onboarding' | 'app'

export function useAuthGate(guard: Guard) {
  const router = useRouter()
  const status = useSessionStore(selectStatus)
  const user = useSessionStore(selectUser)

  useEffect(() => {
    if (status === 'loading') return

    if (status === 'unauthenticated') {
      // A protected route with no session was a protected route WITH one a
      // moment ago — nobody arrives at /dashboard without signing in first — so
      // the way back is the sign-in form, not the front door's create-account
      // pitch. See SIGNED_OUT_ROUTE.
      if (guard !== 'guest') router.replace(SIGNED_OUT_ROUTE)
      return
    }

    // Authenticated from here on.
    const onboarded = !!user?.hasOnboarded
    if (guard === 'guest') {
      router.replace(onboarded ? '/dashboard' : '/onboarding')
    } else if (guard === 'onboarding' && onboarded) {
      router.replace('/dashboard')
    } else if (guard === 'app' && !onboarded) {
      router.replace('/onboarding')
    }
  }, [guard, status, user, router])

  const onboarded = !!user?.hasOnboarded
  const ready =
    status === 'loading'
      ? false
      : guard === 'guest'
        ? status === 'unauthenticated'
        : status === 'authenticated' && (guard === 'app' ? onboarded : !onboarded)

  return { status, user, ready }
}
