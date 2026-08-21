// Open questions attached to REAL tasks. The task always exists — answering
// corrects it rather than creating it — so none of this is a queue the user has
// to clear before their work shows up. Option-pick resolves with no AI; custom
// text triggers one bounded Gemini interpret server-side. Optimistic-remove on
// resolve/drop/defer so the card stack advances instantly.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { api } from '@/lib/api/client'
import { staticMessages } from '@/lib/i18n/staticMessages'
import { CLASH_PANEL_MS } from '@/lib/decisionPanel'
import { requestOpenMatter } from '@/lib/openMatterStore'
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

/**
 * What became of questions whose ids a caller already holds.
 *
 * The chat transcript needs this and `useClarifications` cannot give it. That
 * one lists VISIBLE OPEN rows, so a row missing from it may have been resolved,
 * dropped, or only deferred — and a card that treats absence as "answered"
 * would show a tick over a question still sitting in the user's queue.
 *
 * Without it the chat card knew only what happened while it was mounted:
 * answering a question and reopening the conversation re-rendered the hold from
 * the tool call in history, options untapped and Save armed, as though nothing
 * had been said. The answer was on the server the whole time.
 */
export interface ClarificationStatus {
  clarification: Clarification
  /** The matter as it stands now — the CONFIRMED time, not the guess. Null if deleted. */
  task: { id: string; title?: string; dueAt?: string; kind?: string } | null
}

export function useClarificationStatuses(ids: readonly string[]) {
  return useQuery({
    queryKey: queryKeys.clarificationStatuses(ids),
    queryFn: () =>
      api<{ clarifications: ClarificationStatus[] }>(
        `/me/clarifications/by-ids?ids=${encodeURIComponent(ids.join(','))}`,
      ),
    enabled: ids.length > 0,
    // A resolved row never reopens, so this is close to immutable once answered.
    // The window is short enough that a row answered elsewhere in this session —
    // /uncertainties, another tab — still catches up on the next mount.
    staleTime: 30_000,
    select: (data) => data.clarifications ?? [],
  })
}

/**
 * What the server reports back about the answer itself.
 *
 * The question that gets asked most often here is "what time?", and until now
 * nothing checked whether the time the user picked was free. So the clash a
 * held item was flagged for could be created BY the answer to the question that
 * flagged it — silently, with the question then marked resolved. Every other way
 * of setting a date in this product is checked; this was the one route that
 * wrote a due date and asked nothing.
 *
 * Reported, never enforced: the answer stands, and the clash comes back with
 * times that are known free so it is one more tap rather than a wall.
 */
export interface ResolveOutcome {
  clarification: Clarification
  task: { id: string; title?: string; dueAt?: string } | null
  conflicts?: { taskId: string; title: string; dueAt: string | null; kind?: string; reason: string }[]
  /** Free instants, soonest first. Only ever sent alongside a conflict. */
  suggestions?: string[]
  suggestionReason?: string
}

export function useResolveClarification() {
  const queryClient = useQueryClient()
  const router = useRouter()
  // A hook, so `useTranslations` is available — the right tool here. The
  // re-check copy carries a matter's title and a clock time, and
  // staticMessages() is lookup-only for exactly that reason.
  const t = useTranslations('uncertainty')

  return useMutation({
    mutationFn: (vars: { id: string; answer: ClarificationAnswer; timezone?: string }) =>
      api<ResolveOutcome>(`/me/clarifications/${vars.id}/resolve`, {
        method: 'POST',
        body: { answer: vars.answer, timezone: vars.timezone },
      }),
    onMutate: (vars) => removeOptimistically(queryClient, vars.id),
    onSuccess: (outcome) => {
      const clash = outcome.conflicts?.[0]
      const taskId = outcome.task?.id
      if (!clash || !taskId) return

      // THE SAME PANEL A CLASH RAISES ANYWHERE ELSE.
      //
      // This used to be a plain info toast carrying one "Move to 16:30" action,
      // which was the odd one out: every other surface answers a clash with the
      // two-answer decision panel, and one pre-picked time is not a decision. It
      // also read as a notice — the thing you glance at and let go — for the one
      // outcome the user most needs to act on, having just chosen the time that
      // caused it.
      //
      // Reschedule opens the MATTER rather than patching a time in place. That is
      // the same route the voice clash panel takes, and it is what puts the real
      // editor, the free-slot chips and the live re-check in front of the user
      // instead of a single instant chosen for them.
      //
      // A toast still, not a modal: the stack has already advanced and the next
      // question is on screen. Interrupting that would punish answering.
      toast.decide({
        tone: 'clash',
        title: t('stillClashes', { title: clash.title }),
        // `clash.reason` is server-written English prose, so it is deliberately
        // NOT shown — the user may be reading the rest of this in Arabic.
        description: outcome.suggestions?.length ? undefined : t('stillClashesNoSlot'),
        primary: {
          label: t('reschedule'),
          onPress: () => {
            requestOpenMatter(taskId)
            router.push('/matters/')
          },
        },
        // Nothing to settle: the question was answered, and the clash is a fact
        // about two saved matters that stays visible on the dashboard and in the
        // conflicts sheet. This button says "I know" and nothing more.
        secondary: { label: t('keepAnyway'), onPress: () => {} },
        duration: CLASH_PANEL_MS,
      })
    },
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
