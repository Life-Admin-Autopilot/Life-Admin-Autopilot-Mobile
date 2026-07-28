// Security surfaces: the signed-in-devices list and password change.
//
// Both endpoints need the caller's own refresh token in the BODY — the server
// hashes it to work out which session is "this device". That is also why the
// list is a POST: a GET would put the token in a URL, and from there into every
// access log and browser history entry it passes through.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { useSessionStore } from '@/lib/auth/sessionStore'
import { queryKeys } from '@/queries/keys'

export interface AppSession {
  id: string
  /** True for the device making the request. */
  current: boolean
  userAgent?: string
  ip?: string
  createdAt?: string
  lastUsedAt?: string
}

interface SessionsResponse {
  sessions: AppSession[]
}

export function useSessions() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () =>
      api<SessionsResponse>('/auth/sessions/list', {
        method: 'POST',
        body: { refreshToken: useSessionStore.getState().refreshToken },
      }),
    // Short: the whole point of this list is to be current when someone is
    // checking whether a device they don't recognise is still in.
    staleTime: 10_000,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  })
}

export function useRevokeOtherSessions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api<void>('/auth/sessions/revoke-others', {
        method: 'POST',
        body: { refreshToken: useSessionStore.getState().refreshToken },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  })
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export function useChangePassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api<void>('/auth/change-password', {
        method: 'POST',
        body: {
          ...input,
          // Without this the server revokes EVERY session — including the one
          // making the request — and the user is thrown out of the app for
          // successfully changing their password.
          refreshToken: useSessionStore.getState().refreshToken,
        },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
  })
}
