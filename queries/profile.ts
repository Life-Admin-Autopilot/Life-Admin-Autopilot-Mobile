// Profile read + update. `useUpdateProfile` is how onboarding commits (name,
// onboardingAnswers, preferredDomains, hasOnboarded). On success it syncs the
// session store so the gate + greeting reflect the new user immediately.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import {
  useSessionStore,
  type AuthUser,
  type NotificationPrefs,
  type OnboardingAnswer,
  type Theme,
} from '@/lib/auth/sessionStore'
import { queryKeys } from '@/queries/keys'

interface MeResponse {
  user: AuthUser
}

export interface ProfilePatch {
  displayName?: string
  preferredDomains?: string[]
  hasOnboarded?: boolean
  onboardingAnswers?: OnboardingAnswer[]
  theme?: Theme
  /** IANA zone, e.g. `Africa/Cairo`. The server validates it. */
  timezone?: string
  /** BCP 47 tag, e.g. `en-GB`. */
  locale?: string
  /**
   * Partial by design — the server flattens nested patches to dot-notation
   * `$set` keys, so sending `{ push: false }` leaves its siblings alone.
   */
  notifications?: Partial<NotificationPrefs>
}

export function useProfile() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>('/auth/me'),
    staleTime: 60_000,
  })
}

export function useUpdateProfile() {
  const setUser = useSessionStore((s) => s.setUser)
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: ProfilePatch) =>
      api<MeResponse>('/me', { method: 'PATCH', body: patch }),
    onSuccess: (data) => {
      setUser(data.user)
      void queryClient.invalidateQueries({ queryKey: queryKeys.me })
    },
  })
}
