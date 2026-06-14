// Uncertainty queue — the AI's held items (holdForClarification). List on the
// dashboard, resolve/drop fast. Option-pick resolves with no AI; custom text
// triggers one bounded Gemini interpret server-side. Optimistic-remove on
// resolve/drop so the card-stack advances instantly.

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
  status: 'open' | 'resolved' | 'dropped'
  draft: ClarificationDraft
  question: string
  kind: 'date' | 'detail' | 'choice'
  options: ClarificationOption[]
  answer?: string
  createdTaskId?: string
  createdAt: string
  updatedAt: string
}
export type ClarificationAnswer = { type: 'option'; index: number } | { type: 'custom'; text: string }

interface ListResponse {
  clarifications: Clarification[]
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
    },
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
