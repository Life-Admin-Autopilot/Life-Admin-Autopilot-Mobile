// Email verification and email change — both driven by a six-digit code typed
// into the app, not a link tapped in a mail client.
//
// That is not a style choice. The native shell registers no URL scheme yet
// (docs/CAPACITOR.md), so a `lifeadmin://…` link in an email has nothing to
// open and the flow dead-ends. A code works identically on web and in the
// Capacitor webview with no native configuration at all.

import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { useSessionStore, type AuthUser } from '@/lib/auth/sessionStore'
import { queryKeys } from '@/queries/keys'

interface MeResponse {
  user: AuthUser
}

// Every mutation here can change the identity the rest of the app renders, so
// they all land in both places: the Zustand store (which feeds the route gate
// and the header greeting synchronously) and the query cache.
function useSyncUser() {
  const setUser = useSessionStore((s) => s.setUser)
  const queryClient = useQueryClient()
  return (data: MeResponse) => {
    setUser(data.user)
    void queryClient.invalidateQueries({ queryKey: queryKeys.me })
  }
}

export function useSendVerificationCode() {
  return useMutation({
    mutationFn: () => api<void>('/auth/verify-email/send-code', { method: 'POST' }),
  })
}

export function useConfirmVerificationCode() {
  const sync = useSyncUser()
  return useMutation({
    mutationFn: (code: string) =>
      api<MeResponse>('/auth/verify-email/confirm-code', { method: 'POST', body: { code } }),
    onSuccess: sync,
  })
}

export interface EmailChangeRequest {
  newEmail: string
  /** Required for password accounts; omitted for magic-link-only ones. */
  password?: string
}

export function useRequestEmailChange() {
  const sync = useSyncUser()
  return useMutation({
    mutationFn: (body: EmailChangeRequest) =>
      api<MeResponse>('/auth/change-email', { method: 'POST', body }),
    // Returns the user with `pendingEmail` set — the identity row reads it to
    // show "Pending: …" without a second request.
    onSuccess: sync,
  })
}

export function useConfirmEmailChange() {
  const sync = useSyncUser()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<MeResponse>('/auth/change-email/confirm', {
        method: 'POST',
        // Keeps this device signed in while the others are pushed out — the
        // sign-in identity just changed underneath them.
        body: { code, refreshToken: useSessionStore.getState().refreshToken },
      }),
    onSuccess: (data) => {
      sync(data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    },
  })
}

export function useCancelEmailChange() {
  const sync = useSyncUser()
  return useMutation({
    mutationFn: async () => {
      await api<void>('/auth/change-email', { method: 'DELETE' })
      return api<MeResponse>('/auth/me')
    },
    onSuccess: sync,
  })
}
