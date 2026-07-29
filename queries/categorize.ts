// AI categorize — propose, review, apply.
//
// The odd one out among the bulk mutations: proposing writes nothing. The run
// is staged server-side as a reviewable proposal, so the cache only needs
// invalidating once the user actually applies it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import { invalidateTasks, type TaskDomain } from '@/queries/tasks'

export type Confidence = 'high' | 'medium' | 'low'

export interface ProposedChange {
  taskId: string
  title: string
  fromDomain: TaskDomain
  toDomain: TaskDomain
  /** Only additions. Categorising never removes a tag the user typed. */
  addedTags: string[]
  confidence: Confidence
  reason: string
}

export interface Proposal {
  opId: string
  changes: ProposedChange[]
  /** Matters looked at and left alone. Only present on a fresh run. */
  unchanged?: number
}

export interface ApplyResult {
  applied: number
  undoToken: string | null
}

export function usePendingProposal() {
  return useQuery({
    queryKey: queryKeys.tasks.categorizePending(),
    queryFn: () =>
      api<{ proposal: Proposal | null }>('/me/tasks/categorize/pending').then((r) => r.proposal),
  })
}

export function useProposeCategorization() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { ids: string[] }) =>
      api<Proposal>('/me/tasks/categorize', { method: 'POST', body }),
    // onSettled, not onSuccess. The interesting failure is a 409 — a proposal
    // is already open — and the sheet answers that by SHOWING the open one, so
    // the error path needs the refetch at least as much as the success path.
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.categorizePending() })
    },
  })
}

export function useApplyProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ opId, taskIds }: { opId: string; taskIds: string[] }) =>
      api<ApplyResult>(`/me/tasks/categorize/${opId}/apply`, { method: 'POST', body: { taskIds } }),
    onSuccess: () => {
      invalidateTasks(qc)
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.categorizePending() })
    },
  })
}

export function useDiscardProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (opId: string) =>
      api<void>(`/me/tasks/categorize/${opId}/discard`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.categorizePending() })
    },
  })
}
