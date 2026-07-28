// Open questions attached to REAL tasks. The task always exists — answering
// corrects it rather than creating it — so none of this is a queue the user has
// to clear before their work shows up. Option-pick resolves with no AI; custom
// text triggers one bounded Gemini interpret server-side. Optimistic-remove on
// resolve/drop/defer so the card stack advances instantly.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export interface ClarificationOption {
  label: string
  dueAt?: string
  title?: string
  notes?: string
}
export interface ClarificationDraft {
  title: string
  domain: string
  priority: string
  notes?: string
  tags: string[]
  dueAt?: string
}
export interface Clarification {
  id: string
  /** The task this question is about — created up front, never withheld. */
  taskId: string
  status: 'open' | 'resolved' | 'dropped'
  draft: ClarificationDraft
  question: string
  kind: 'date' | 'detail' | 'choice'
  /** 'high' → the task's reminder waits for confirmation. 'low' → it may fire on the guess. */
  costOfWrong: 'low' | 'high'
  options: ClarificationOption[]
  answer?: string
  createdAt: string
  updatedAt: string
}
export type ClarificationAnswer = { type: 'option'; index: number } | { type: 'custom'; text: string }

interface ListResponse {
  clarifications: Clarification[]
  hasMore?: boolean
  nextCursor?: string | null
}

export function useClarifications() {
  return useQuery({
    queryKey: queryKeys.clarifications,
    queryFn: () => api<ListResponse>('/me/clarifications'),
    staleTime: 30_000,
  })
}

export function useResolveClarification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; answer: ClarificationAnswer; timezone?: string }) =>
      api<{ clarification: Clarification; task: unknown }>(`/me/clarifications/${vars.id}/resolve`, {
        method: 'POST',
        body: { answer: vars.answer, timezone: vars.timezone },
      }),
    onMutate: (vars) => removeOptimistically(queryClient, vars.id),
    onError: (_e, _v, ctx) => restore(queryClient, ctx),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
    },
  })
}

/**
 * "Not now" — the card stack's Skip. Hides the item for a cooling-off window
 * instead of only advancing a local index, which left the row untouched and
 * re-served it next session.
 */
export function useDeferClarification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ clarification: Clarification }>(`/me/clarifications/${id}/defer`, { method: 'POST' }),
    onMutate: (id) => removeOptimistically(queryClient, id),
    onError: (_e, _v, ctx) => restore(queryClient, ctx),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications }),
  })
}

export function useDropClarification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ clarification: Clarification }>(`/me/clarifications/${id}/drop`, { method: 'POST' }),
    onMutate: (id) => removeOptimistically(queryClient, id),
    onError: (_e, _v, ctx) => restore(queryClient, ctx),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications }),
  })
}

interface RemoveCtx {
  prev?: ListResponse
}
function removeOptimistically(queryClient: QueryClient, id: string): RemoveCtx {
  const prev = queryClient.getQueryData<ListResponse>(queryKeys.clarifications)
  if (prev) {
    queryClient.setQueryData<ListResponse>(queryKeys.clarifications, {
      clarifications: prev.clarifications.filter((c) => c.id !== id),
    })
  }
  return { prev }
}
function restore(queryClient: QueryClient, ctx: RemoveCtx | undefined): void {
  if (ctx?.prev) queryClient.setQueryData(queryKeys.clarifications, ctx.prev)
}
