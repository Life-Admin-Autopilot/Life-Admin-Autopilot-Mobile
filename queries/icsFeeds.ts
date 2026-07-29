// Subscribed calendar feeds — school terms, bin collections, fixtures.
//
// A sync writes matters, so every mutation here invalidates BOTH `icsFeeds`
// (the list and its health) and `tasks` / `digest` (what the sync produced).
// Missing the second half is why a newly-subscribed feed would appear connected
// while the Matters list stayed empty until a manual refresh.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export type IcsFeedStatus = 'active' | 'error' | 'gone'

export interface IcsFeed {
  id: string
  url: string
  label: string
  domain: string
  status: IcsFeedStatus
  lastSyncedAt?: string
  lastFetchedAt?: string
  /** Plain-language reason the last poll failed. Present when status !== 'active'. */
  lastError?: string
  failureCount: number
  createdAt: string
}

export interface IcsSyncResult {
  status: 'unchanged' | 'synced' | 'gone' | 'error'
  created: number
  updated: number
  /**
   * Occurrences whose time was ambiguous — a floating DTSTART with no timezone.
   * They are filed as passive list items that never fire, so this count is what
   * the UI must surface: "4 need a time confirmed" is the honest headline, not
   * a silent success.
   */
  needingConfirmation: number
  reason?: string
}

interface FeedListResponse {
  feeds: IcsFeed[]
}

interface FeedMutationResponse {
  feed: IcsFeed
  sync: IcsSyncResult
}

export interface SubscribeFeedInput {
  url: string
  label: string
  domain: string
}

export function useIcsFeeds() {
  return useQuery({
    queryKey: queryKeys.icsFeeds,
    queryFn: () => api<FeedListResponse>('/me/ics-feeds'),
    staleTime: 30_000,
  })
}

/** Invalidate everything a sync can have touched. */
function useInvalidateAfterSync() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.icsFeeds })
    void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
    void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
  }
}

export function useSubscribeIcsFeed() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    mutationFn: (input: SubscribeFeedInput) =>
      api<FeedMutationResponse>('/me/ics-feeds', { method: 'POST', body: input }),
    onSuccess: invalidate,
  })
}

export function useSyncIcsFeed() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    mutationFn: (id: string) =>
      api<FeedMutationResponse>(`/me/ics-feeds/${id}/sync`, { method: 'POST' }),
    onSuccess: invalidate,
  })
}

export function useRemoveIcsFeed() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    // Removing a feed also retires its future matters server-side, which is why
    // this invalidates tasks too rather than just dropping a row from the list.
    mutationFn: (id: string) =>
      api<{ removed: boolean; retiredMatters: number }>(`/me/ics-feeds/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: invalidate,
  })
}
