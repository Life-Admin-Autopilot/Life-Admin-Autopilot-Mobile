'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { AppSplash } from '@/components/auth/AppSplash'
import { useSessionStore, selectStatus, selectUser } from '@/lib/auth/sessionStore'

// Root gate — routes to the right place once the session resolves. The
// styleguide moved to /styleguide. Renders the splash while deciding.
export default function GatePage() {
  const router = useRouter()
  const status = useSessionStore(selectStatus)
  const user = useSessionStore(selectUser)

  useEffect(() => {
    if (status === 'loading') return
    if (status === 'unauthenticated') {
      router.replace('/welcome')
      return
    }
    router.replace(user?.hasOnboarded ? '/dashboard' : '/onboarding')
  }, [status, user, router])

  return <AppSplash />
}
