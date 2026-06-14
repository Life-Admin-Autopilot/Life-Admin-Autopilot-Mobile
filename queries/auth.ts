// Auth mutations. On success they hydrate the session store, which flips
// `status` → 'authenticated' and lets the route gate route onward. The HTTP
// seam is lib/api/client.ts; these are unauthenticated calls.

import { useMutation } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { useSessionStore, type AuthUser } from '@/lib/auth/sessionStore'

interface Credentials {
  email: string
  password: string
}

interface AuthResponse {
  user: AuthUser
  tokens: { accessToken: string; refreshToken: string }
}

export function useSignUp() {
  const setSession = useSessionStore((s) => s.setSession)
  return useMutation({
    mutationFn: (body: Credentials) =>
      api<AuthResponse>('/auth/signup', { method: 'POST', body, authenticated: false }),
    onSuccess: (data) => setSession(data),
  })
}

export function useSignIn() {
  const setSession = useSessionStore((s) => s.setSession)
  return useMutation({
    mutationFn: (body: Credentials) =>
      api<AuthResponse>('/auth/signin', { method: 'POST', body, authenticated: false }),
    onSuccess: (data) => setSession(data),
  })
}

export function useSignOut() {
  const clear = useSessionStore((s) => s.clear)
  return useMutation({
    mutationFn: async () => {
      const refreshToken = useSessionStore.getState().refreshToken
      // Best-effort server revoke; clear locally regardless.
      try {
        await api('/auth/signout', { method: 'POST', body: { refreshToken } })
      } catch {
        /* ignore — local clear is what matters for the gate */
      }
    },
    onSuccess: () => clear(),
  })
}
