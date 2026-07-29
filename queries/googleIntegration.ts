// The connected Google account.
//
// The connect flow is unusual and the reason is worth stating: the consent
// screen CANNOT open inside the app. Google answers OAuth attempted from an
// embedded webview with `disallowed_useragent`, and the Capacitor shell is
// exactly that. So the app asks the server for a URL, opens it in the SYSTEM
// browser, and waits — on native for a `kitto://` deep link, on web for the tab
// to be closed and focus to come back.
//
// Every token stays on the server. Nothing secret is ever handed to the client.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export type IntegrationStatus = 'active' | 'needs_reauth' | 'revoked'

export interface GoogleIntegration {
  id: string
  externalAccountEmail?: string
  grantedScopes: string[]
  status: IntegrationStatus
  lastError?: string
  importDomain: string
  calendarSyncedAt?: string
  tasksSyncedAt?: string
  connectedAt: string
}

export interface GoogleIntegrationState {
  /** False when the server has no Google credentials configured. */
  available: boolean
  integration: GoogleIntegration | null
}

export interface GoogleSyncResult {
  calendar: {
    status: 'synced' | 'skipped'
    created: number
    updated: number
    /** Meetings and recurring slots — seen, deliberately not filed as matters. */
    commitments: number
    ignored: number
    fullResync: boolean
    reason?: string
  }
  tasks: {
    status: 'synced' | 'skipped'
    created: number
    updated: number
    reason?: string
  }
}

export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'
export const SCOPE_TASKS = 'https://www.googleapis.com/auth/tasks.readonly'

export function useGoogleIntegration() {
  return useQuery({
    queryKey: queryKeys.googleIntegration,
    queryFn: () => api<GoogleIntegrationState>('/integrations/google'),
    staleTime: 15_000,
  })
}

/**
 * Ask the server for a consent URL.
 *
 * `web` is sent so the server knows there is no app to deep-link back into and
 * can end the flow with a plain page instead. It travels inside the SIGNED
 * state from there — the callback is unauthenticated, so a flag read from its
 * query string would let anyone redirect our OAuth exit.
 */
export function useGoogleAuthorizeUrl() {
  return useMutation({
    mutationFn: (web: boolean) =>
      api<{ url: string }>('/integrations/google/authorize', {
        method: 'POST',
        body: { web },
      }),
  })
}

function useInvalidateAfterSync() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.googleIntegration })
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
  }
}

export function useSyncGoogle() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    mutationFn: () => api<GoogleSyncResult>('/integrations/google/sync', { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export function useDisconnectGoogle() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    mutationFn: () => api<{ removed: boolean }>('/integrations/google', { method: 'DELETE' }),
    onSuccess: invalidate,
  })
}
