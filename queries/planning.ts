// Propose / commit — the two-phase capture flow.
//
// The distinction that makes this worth its own module: `propose` NEVER writes.
// It returns drafts with conflict warnings so the user can review them, and only
// `commit` — one call per confirmed draft — creates anything. That ordering is
// deliberate: conflict detection has to happen before a task exists, not after.
//
// Contrast with the chat agent (queries/ai.ts), whose tools write the moment it
// calls them. Capture goes through here; conversation goes through there.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, ApiError } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import { deviceTimeZone } from '@/lib/i18n/dateFormat'
import type { TaskDomain, TaskKind, TaskPriority } from '@/queries/tasks'

export interface DraftConflict {
  taskId: string
  title: string
  dueAt: string | null
  /** 'time_clash' | 'duplicate' — the briefing sends the same shape. */
  kind?: string
  reason: string
}

export interface TaskDraft {
  title: string
  dueDate: string | null
  category: TaskDomain
  priority: TaskPriority
  kind: TaskKind | null
  notes: string | null
  sourceType: string
  /** 0..1 from the extractor. Below ~0.6 the UI should ask rather than assume. */
  confidence: number
  conflicts: DraftConflict[]
  /**
   * The day came from the user; the clock time did not.
   *
   * A task stores one instant, so "Wednesday" has to become some specific moment,
   * and the extractor picks 09:00. Rendering that like any other time passes our
   * guess off as their decision — which is how three matters dictated in one
   * breath all landed at 09:00 with nothing asked. When this is set the UI must
   * ask for the real time before saving.
   */
  timeAssumed?: boolean
}

/** Turn one utterance into draft tasks. Reads only — nothing is saved. */
export function useProposeTasks() {
  return useMutation({
    mutationFn: async (text: string): Promise<TaskDraft[]> => {
      const res = await api<{ draftTasks: TaskDraft[] }>('/api/planning/propose', {
        method: 'POST',
        body: { text, timezone: deviceTimeZone() },
      })
      return res.draftTasks ?? []
    },
  })
}

/** The 409 the commit endpoint answers with when a clash has not been acknowledged. */
export const CONFLICT_CODE = 'conflict_detected'

/**
 * Pull the clashing matters out of a rejected commit.
 *
 * The server refuses rather than warns, so this is not decoration — it is the
 * only way the user finds out what they collided with, and a refusal they cannot
 * act on would be worse than the silent save it replaced.
 */
export function conflictsFromError(err: unknown): DraftConflict[] | null {
  if (!(err instanceof ApiError) || err.code !== CONFLICT_CODE) return null
  const details = err.details as { conflicts?: DraftConflict[] } | null
  return details?.conflicts ?? []
}

/**
 * Save ONE confirmed draft.
 *
 * Per draft, not per proposal: a user who confirms two of three and closes the
 * app keeps those two. The committed values come from the (possibly edited)
 * draft in hand, so propose holds no server-side state that could go stale.
 *
 * `confirmConflicts` asserts the user has SEEN the clash and still wants it.
 * Without it the server refuses with 409 — which is the point: a draft can be
 * edited onto a collision after it was proposed, or another matter can land
 * there in the meantime, so the check that counts is the one at the write.
 */
export function useCommitDraft() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      draft,
      confirmConflicts = false,
    }: {
      draft: TaskDraft
      confirmConflicts?: boolean
    }) =>
      api<{ task: { id: string } }>('/api/planning/commit', {
        method: 'POST',
        body: {
          title: draft.title,
          category: draft.category,
          priority: draft.priority,
          kind: draft.kind,
          dueDate: draft.dueDate,
          notes: draft.notes,
          confirmConflicts,
        },
      }),
    onSuccess: () => {
      // A new matter changes the list, the counts and today's briefing.
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.briefing() })
    },
  })
}

export interface BriefingItem {
  taskId: string
  title: string
  domain: TaskDomain
  dueAt: string | null
  overdue: boolean
}

export interface Briefing {
  headline: string
  summary: string
  /** False when the model was unreachable and the summary is the deterministic one. */
  phrased: boolean
  items: BriefingItem[]
  conflicts: DraftConflict[]
}

/** The Knowledge Agent's daily briefing. */
export function useBriefing() {
  return useQuery({
    queryKey: queryKeys.briefing(),
    queryFn: () =>
      api<Briefing>(`/me/briefing/today?timezone=${encodeURIComponent(deviceTimeZone())}`),
    // The day's facts do not change minute to minute, and the phrasing costs a
    // model call — so this is not a chatty poll.
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Would this change clash? Asked BEFORE the change is made.
 *
 * The sibling `useTaskConflicts` asks about a task as it already stands, which
 * can only ever produce a warning about something that has happened. This asks
 * about a change that has not, so a caller can decline to make it — the same
 * ordering the chat agent's updateTask tool now follows.
 *
 * Returns [] rather than throwing when the check itself fails: a conflict check
 * that cannot run is not a reason to block an edit the user asked for.
 */
export async function previewConflicts(
  taskId: string,
  change: { dueAt?: string | null; title?: string },
): Promise<DraftConflict[]> {
  try {
    const res = await api<{ conflicts: DraftConflict[] }>(`/me/tasks/${taskId}/conflicts`, {
      method: 'POST',
      body: change,
    })
    return res.conflicts ?? []
  } catch {
    return []
  }
}

/**
 * Would this DRAFT clash? Asked while the user is still choosing a time.
 *
 * Separate from `previewConflicts` because a draft has no task id — nothing is
 * saved yet — and needing one is what made the capture flow wait until Save to
 * discover a collision.
 *
 * Returns [] on failure for the same reason as its sibling: a check that cannot
 * run must not present itself as "no conflicts found" AND must not block the
 * user. The server re-checks at the write regardless, so this is an early
 * warning, never the enforcement.
 */
export interface ConflictPreview {
  conflicts: DraftConflict[]
  /** Free slots that suit this kind of matter, soonest first. Empty when clear. */
  suggestions: string[]
  /** Which part of the day those slots came from — "evening", "working hours". */
  suggestionReason: string
}

export async function previewDraftConflicts(draft: {
  title: string
  dueDate: string | null
}): Promise<ConflictPreview> {
  try {
    return await api<ConflictPreview>('/me/conflicts', {
      method: 'POST',
      body: { title: draft.title, dueAt: draft.dueDate, timezone: deviceTimeZone() },
    })
  } catch {
    return { conflicts: [], suggestions: [], suggestionReason: '' }
  }
}

/** Conflicts for one existing task, re-checked after an edit. */
export function useTaskConflicts(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.taskConflicts(taskId ?? ''),
    queryFn: () =>
      api<{ taskId: string; conflicts: DraftConflict[] }>(`/me/tasks/${taskId}/conflicts`),
    enabled: Boolean(taskId),
  })
}
