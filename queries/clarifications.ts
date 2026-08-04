// Open questions attached to REAL tasks. The task always exists — answering
// corrects it rather than creating it — so none of this is a queue the user has
// to clear before their work shows up. Option-pick resolves with no AI; custom
// text triggers one bounded Gemini interpret server-side. Optimistic-remove on
// resolve/drop/defer so the card stack advances instantly.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import { staticMessages } from '@/lib/i18n/staticMessages'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { queryKeys } from '@/queries/keys'
import { adjustNeedsInput, type TaskCounts } from '@/queries/tasks'

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
  /**
   * What the user actually said — the chat message or voice transcript this
   * question came out of. Absent on rows written before it was captured, so
   * every surface that shows it must tolerate it being missing.
   */
  sourceText?: string
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
    onError: (err, _v, ctx) => {
      restore(queryClient, ctx)
      reportFailure(err)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
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
    onError: (err, _v, ctx) => {
      restore(queryClient, ctx)
      reportFailure(err)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
    },
  })
}

export function useDropClarification() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<{ clarification: Clarification }>(`/me/clarifications/${id}/drop`, { method: 'POST' }),
    onMutate: (id) => removeOptimistically(queryClient, id),
    onError: (err, _v, ctx) => {
      restore(queryClient, ctx)
      reportFailure(err)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications })
      void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
    },
  })
}

// The card stack advances the instant you answer — it never waits for the
// round trip, which is what makes it feel fast. The cost is that a failed
// answer used to be invisible: the card moved on, the stack reached "All
// clear.", and nothing had been written. Say so instead.
//
// A mutation callback, so the title is read from the catalogue rather than
// taken as a translator argument — the case lib/i18n/staticMessages.ts covers.
// The description carries no fallback of its own on purpose: translateBackendError
// already defaults to `errors.generic` in the reader's language, and a fallback
// here would be a second English sentence to keep in step with it.
function reportFailure(err: unknown): void {
  toast.error(staticMessages().lib.clarifications.answerNotSaved, {
    description: translateBackendError(err),
  })
}

interface RemoveCtx {
  prev?: ListResponse
  prevCounts?: TaskCounts
}

// Drop a question from the stack AND from the home count, before the server has
// agreed. Both have to move together: the card advancing while "A few guesses to
// confirm" still sits on the dashboard behind it is the same state described two
// different ways.
async function removeOptimistically(
  queryClient: QueryClient,
  id: string,
): Promise<RemoveCtx> {
  // Cancel first. A read that was already in flight when the user tapped will
  // resolve with the pre-tap list and put the answered question straight back.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.clarifications }),
    queryClient.cancelQueries({ queryKey: queryKeys.tasks.counts() }),
  ])

  const prev = queryClient.getQueryData<ListResponse>(queryKeys.clarifications)
  const prevCounts = queryClient.getQueryData<TaskCounts>(queryKeys.tasks.counts())

  if (prev) {
    // Spread rather than rebuild: hasMore/nextCursor belong to this page and
    // dropping them would silently end the pagination.
    queryClient.setQueryData<ListResponse>(queryKeys.clarifications, {
      ...prev,
      clarifications: prev.clarifications.filter((c) => c.id !== id),
    })
  }
  adjustNeedsInput(queryClient, -1)

  return { prev, prevCounts }
}

function restore(queryClient: QueryClient, ctx: RemoveCtx | undefined): void {
  if (ctx?.prev) queryClient.setQueryData(queryKeys.clarifications, ctx.prev)
  if (ctx?.prevCounts) queryClient.setQueryData(queryKeys.tasks.counts(), ctx.prevCounts)
}
