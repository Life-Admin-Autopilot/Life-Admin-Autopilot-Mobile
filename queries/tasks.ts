// The Task data layer. Every surface that reads or writes a matter — the
// Matters list, the dashboard, the documents review flow — goes through here,
// so cache invalidation happens in one place.
//
// Domain/priority/status/kind are declared here rather than imported from
// queries/documentScans, because a Task is the canonical thing and a scan
// candidate is a proposal for one. documentScans re-exports these for
// compatibility with its existing callers.

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'

import { api, toQuery } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export const TASK_DOMAINS = ['health', 'home', 'car', 'finance', 'family', 'pets'] as const
export type TaskDomain = (typeof TASK_DOMAINS)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_STATUSES = ['open', 'done', 'snoozed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

// 'reminder' fires at its due moment; 'list' is passive. The distinction is
// load-bearing — a reminder without a date is a broken promise, and the server
// rejects one.
export const TASK_KINDS = ['reminder', 'list'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export type TaskConfidence = 'high' | 'medium' | 'low'

export interface Subtask {
  id: string
  text: string
  done: boolean
}

// An AI-guessed (or user-corrected) window for how long the matter takes to do.
// Always a bucketed RANGE, never a single number — the width is how the system
// admits it is estimating. `source: 'user'` means the person set it by hand and
// no AI pass will overwrite it. Absent on every matter created before the
// feature existed, so every surface must render without it.
export interface TaskEstimate {
  minMinutes: number
  maxMinutes: number
  source: 'ai' | 'user'
}

export interface TaskReminder {
  at: string
  firedAt?: string
  kind: 'lead' | 'due' | 'ai'
}

export interface Task {
  id: string
  title: string
  domain: TaskDomain
  kind: TaskKind
  status: TaskStatus
  priority: TaskPriority
  // Derived server-side from the priority table so the client never duplicates it.
  priorityRank: number
  tags: string[]
  subtasks: Subtask[]
  reminders: TaskReminder[]
  dueAt?: string
  notes?: string
  completedAt?: string
  snoozedUntil?: string
  confidence?: TaskConfidence
  estimate?: TaskEstimate
  sourceVoiceNoteId?: string
  sourceDocumentId?: string
  /** Set when this matter came from a connected service rather than from you. */
  externalSource?: 'google_calendar' | 'google_tasks' | 'apple_calendar' | 'apple_reminders' | 'ics_feed' | 'email_forward'
  /**
   * How precisely the external source specified the time.
   *
   * `dateOnly` — the source gave a date and no time, so `dueAt`'s time-of-day is
   * YOUR default, not theirs. `floating` — the source gave a wall clock with no
   * timezone, so we assumed yours and the matter does not nudge until you
   * confirm. Both must be visible: a rendered time that looks source-derived but
   * isn't is exactly the trust failure principles.md is built around.
   */
  timePrecision?: 'exact' | 'dateOnly' | 'floating'
  rescheduleCount: number
  createdAt: string
  updatedAt: string
}

export const TASK_SORTS = [
  'due-asc',
  'due-desc',
  'created-desc',
  'created-asc',
  'priority-desc',
  'title-asc',
] as const
export type TaskSort = (typeof TASK_SORTS)[number]

// The labels live in the catalogue under `matters.sortBy.<TaskSort>` — keyed by
// the sort value itself, so SortSheet reads them straight off TASK_SORTS. A
// Record here would have been a second, English-only source of truth for the
// same six strings.

// Mirrors the server's TaskFilterSchema. Arrays serialize to comma-separated
// values; see toQuery.
export interface TaskFilters {
  q?: string
  status?: TaskStatus[]
  domain?: TaskDomain[]
  priority?: TaskPriority[]
  kind?: TaskKind[]
  tag?: string[]
  dueBefore?: string
  dueAfter?: string
  createdBefore?: string
  createdAfter?: string
  completedBefore?: string
  completedAfter?: string
  overdue?: boolean
  undated?: boolean
  untagged?: boolean
}

export interface TaskCounts {
  overdue: number
  today: number
  tomorrow: number
  thisWeek: number
  later: number
  undated: number
  open: number
  done: number
  trashed: number
  slipping: number
  /** Finished inside the local day — the day-progress numerator. */
  completedToday: number
  /** Open questions and unreviewed scans: the "Needs you" strip, in one read. */
  needsInput: number
  scansAwaitingReview: number
  byDomain: Partial<Record<TaskDomain, number>>
  byPriority: Partial<Record<TaskPriority, number>>
}

interface TaskListPage {
  tasks: Task[]
  total: number
  nextCursor: string | null
}

// True when the user has narrowed the list at all — drives whether the empty
// state reads "nothing matches that" or "nothing here yet".
export function hasActiveFilters(filters: TaskFilters): boolean {
  return Object.values(filters).some((v) =>
    Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '' && v !== false,
  )
}

const PAGE_SIZE = 50

export function useTasks(filters: TaskFilters, sort: TaskSort = 'due-asc') {
  return useInfiniteQuery({
    queryKey: queryKeys.tasks.list({ ...filters, sort }),
    queryFn: ({ pageParam }) =>
      api<TaskListPage>(
        `/me/tasks${toQuery({ ...filters, sort, limit: PAGE_SIZE, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
}

export function useTaskCounts() {
  return useQuery({
    queryKey: queryKeys.tasks.counts(),
    queryFn: () =>
      api<{ counts: TaskCounts }>(
        `/me/tasks/counts${toQuery({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`,
      ).then((r) => r.counts),
  })
}

// Nudge the cached "questions waiting on you" figure without a round trip.
//
// The count drives a row on the home screen, and home sits BEHIND the chat
// island rather than being replaced by it — so a question raised mid-turn, or
// answered on the card stack, is editing a surface the user can see. Waiting for
// the server to confirm a number we already know the delta of is the difference
// between the strip responding to the tap and responding a second later.
//
// A no-op until the counts have loaded once: inventing a cache entry from a
// delta would put an unanchored number on screen. Clamped at zero, and always
// followed by an invalidation — this closes the gap, it is not the source of
// truth.
export function adjustNeedsInput(qc: QueryClient, delta: number): void {
  qc.setQueryData<TaskCounts>(queryKeys.tasks.counts(), (prev) =>
    prev ? { ...prev, needsInput: Math.max(0, prev.needsInput + delta) } : prev,
  )
}

export function useTaskTags() {
  return useQuery({
    queryKey: queryKeys.tasks.tags(),
    queryFn: () => api<{ tags: string[] }>('/me/tasks/tags').then((r) => r.tags),
  })
}

export function useTrashedTasks(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tasks.trash(),
    queryFn: () => api<{ tasks: Task[] }>('/me/tasks/trash').then((r) => r.tasks),
    enabled,
  })
}

// Every mutation lands here. Counts and the tag list are derived from tasks, so
// they always go stale together — invalidating them separately is how a header
// ends up disagreeing with the rows under it.
// Exported so queries/categorize.ts reconciles through the same handle rather
// than growing its own idea of what a task write invalidates.
export function invalidateTasks(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
  void qc.invalidateQueries({ queryKey: queryKeys.notifications })
  // The digest's headline is written FROM the matters, so a write staled it too.
  // Its counts no longer matter here — the dashboard reads those from
  // tasks.counts, which the blunt tasks.all handle above already covers.
  void qc.invalidateQueries({ queryKey: queryKeys.digestAll })
}

export interface CreateTaskBody {
  title: string
  domain: TaskDomain
  kind?: TaskKind
  priority?: TaskPriority
  tags?: string[]
  dueAt?: string
  notes?: string
}

// `null` clears a field; omitting it leaves the field alone. Matches the
// server's PATCH semantics exactly.
export interface UpdateTaskBody {
  title?: string
  domain?: TaskDomain
  status?: TaskStatus
  priority?: TaskPriority
  tags?: string[]
  dueAt?: string | null
  notes?: string | null
  snoozedUntil?: string | null
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateTaskBody) =>
      api<{ task: Task }>('/me/tasks', { method: 'POST', body }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: UpdateTaskBody }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}`, { method: 'PATCH', body }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

// Complete and snooze are the two swipe gestures, so they carry an optimistic
// patch — the row must react instantly under the thumb, not a round trip later.
export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, done }: { taskId: string; done: boolean }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status: done ? 'done' : 'open' },
      }).then((r) => r.task),
    onMutate: async ({ taskId, done }) => {
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      const snapshot = qc.getQueriesData({ queryKey: queryKeys.tasks.all })
      patchTaskInCache(qc, taskId, (t) => ({ ...t, status: done ? 'done' : 'open' }))
      return { snapshot }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
    },
    onSettled: () => invalidateTasks(qc),
  })
}

export function useSnoozeTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, until }: { taskId: string; until: string }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}`, {
        method: 'PATCH',
        body: { status: 'snoozed', snoozedUntil: until },
      }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

// Returns the undo token so the caller can offer Undo in a toast.
export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      api<{ undoToken: string | null }>(`/me/tasks/${taskId}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useRestoreTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/restore`, { method: 'POST' }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useEmptyTrash() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ purged: number }>('/me/tasks/trash', { method: 'DELETE' }),
    onSuccess: () => invalidateTasks(qc),
  })
}

// ---- Bulk ----

export type BulkAction =
  | { action: 'delete' }
  | { action: 'complete' }
  | { action: 'snooze'; until: string }
  | { action: 'setDomain'; domain: TaskDomain }
  | { action: 'addTags'; tags: string[] }

export type BulkTarget = { ids: string[] } | { filter: TaskFilters }

export interface BulkWarnings {
  fromDocuments: number
  remindersFired: number
  truncated: boolean
}

export interface BulkPreview {
  count: number
  warnings: BulkWarnings
  sample: Task[]
}

export interface BulkResult {
  affected: number
  undoToken: string | null
  warnings: BulkWarnings
}

// Dry run. Nothing is written — this is what the confirm card renders, so the
// user sees the resolved count and ripple warnings before agreeing to anything.
export function useBulkPreview() {
  return useMutation({
    mutationFn: (body: BulkTarget & BulkAction) =>
      api<BulkPreview>('/me/tasks/bulk/preview', { method: 'POST', body }),
  })
}

export function useBulkAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: BulkTarget & BulkAction & { label?: string }) =>
      api<BulkResult>('/me/tasks/bulk', { method: 'POST', body }),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useUndoBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) =>
      api<{ restored: number }>(`/me/tasks/undo/${token}`, { method: 'POST' }),
    onSuccess: () => invalidateTasks(qc),
  })
}

// ---- Subtasks ----

// Steps are edited in a tight loop — type, enter, tick, tick, remove — and the
// list is right under the thumb, so every one of them lands in the cache on the
// spot and reconciles with the server afterwards. Waiting on a round trip here
// is what made ticking a step feel like submitting a form.
const TEMP_SUBTASK_PREFIX = 'pending:'

let tempSubtaskSeq = 0

// Ids the server hasn't issued yet. Never collides with a Mongo ObjectId, and
// the UI keys off it to know a row is still in flight.
export function isPendingSubtaskId(id: string): boolean {
  return id.startsWith(TEMP_SUBTASK_PREFIX)
}

// Shared so every subtask write can count how many of its siblings are still in
// the air. Ticking a step twice in under a second puts two of them there, and
// they finish in an order nobody controls.
const SUBTASK_MUTATION_KEY = ['subtask'] as const

function useSubtaskMutation<V extends { taskId: string }>(
  mutationFn: (vars: V) => Promise<Task>,
  optimistic: (subtasks: Subtask[], vars: V) => Subtask[],
  // Optional, and deliberately narrow: it may only touch the row this write
  // created. A response is the task as it looked when the SERVER handled this
  // write, so pasting it over the cache wholesale replays stale state on top of
  // newer intent — tick then untick fast and the row flips back to ticked
  // before correcting itself. Toggle and remove learn nothing from the response
  // and so never run one.
  reconcile?: (subtasks: Subtask[], server: Task, vars: V) => Subtask[],
) {
  const qc = useQueryClient()

  // Inside a callback the mutation that owns it still counts as pending, so "1"
  // means "nothing else of mine is in the air".
  const isLastInFlight = () => qc.isMutating({ mutationKey: SUBTASK_MUTATION_KEY }) === 1

  return useMutation({
    mutationKey: SUBTASK_MUTATION_KEY,
    mutationFn,
    onMutate: async (vars: V) => {
      const snapshot = qc.getQueriesData({ queryKey: queryKeys.tasks.all })
      // Patch FIRST, then await. `cancelQueries` is a promise, and there is
      // almost always a refetch in flight to abort — awaiting it before touching
      // the cache pushes the optimistic write past the next paint, which is the
      // exact lag this whole thing exists to remove.
      patchTaskInCache(qc, vars.taskId, (t) => ({ ...t, subtasks: optimistic(t.subtasks, vars) }))
      await qc.cancelQueries({ queryKey: queryKeys.tasks.all })
      return { snapshot }
    },
    // A snapshot taken while siblings were in flight has their optimistic writes
    // baked into it, so restoring it would undo work that hasn't failed. When
    // this isn't the last write, whichever one is will invalidate and let the
    // server settle it.
    onError: (_err, _vars, ctx) => {
      if (!isLastInFlight()) return
      for (const [key, data] of ctx?.snapshot ?? []) qc.setQueryData(key, data)
    },
    onSuccess: (task, vars) => {
      if (!reconcile) return
      patchTaskInCache(qc, vars.taskId, (t) => ({
        ...t,
        subtasks: reconcile(t.subtasks, task, vars),
      }))
    },
    // One refetch per burst, not per write: a refetch fired mid-burst answers
    // with state from before the writes that followed it.
    onSettled: () => {
      if (!isLastInFlight()) return
      invalidateTasks(qc)
    },
  })
}

export function useAddSubtask() {
  return useSubtaskMutation(
    ({ taskId, text }: { taskId: string; text: string }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: { text },
      }).then((r) => r.task),
    (subtasks, { text }) => [
      ...subtasks,
      { id: `${TEMP_SUBTASK_PREFIX}${++tempSubtaskSeq}`, text, done: false },
    ],
    // Swap the placeholder for the id the server just issued, and touch nothing
    // else — the row this write created is the only thing the response can tell
    // us that we didn't already know. Found by "an id the cache has never seen,
    // with our text" rather than by position, so a burst of adds reconciling out
    // of order still lands each id on its own row.
    (subtasks, server, { text }) => {
      const known = new Set(subtasks.map((s) => s.id))
      const issued = server.subtasks.find((s) => !known.has(s.id) && s.text === text)
      if (!issued) return subtasks
      let claimed = false
      return subtasks.map((s) => {
        if (claimed || s.text !== text || !isPendingSubtaskId(s.id)) return s
        claimed = true
        return { ...s, id: issued.id }
      })
    },
  )
}

export function useToggleSubtask() {
  return useSubtaskMutation(
    ({ taskId, subtaskId, done }: { taskId: string; subtaskId: string; done: boolean }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'PATCH',
        body: { done },
      }).then((r) => r.task),
    (subtasks, { subtaskId, done }) =>
      subtasks.map((s) => (s.id === subtaskId ? { ...s, done } : s)),
  )
}

export function useRemoveSubtask() {
  return useSubtaskMutation(
    ({ taskId, subtaskId }: { taskId: string; subtaskId: string }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'DELETE',
      }).then((r) => r.task),
    (subtasks, { subtaskId }) => subtasks.filter((s) => s.id !== subtaskId),
  )
}

// Patch one task everywhere it appears across every cached filter+page, so an
// optimistic update lands on whichever list the user is actually looking at.
function patchTaskInCache(qc: QueryClient, taskId: string, patch: (t: Task) => Task) {
  qc.setQueriesData<{ pages: TaskListPage[]; pageParams: unknown[] }>(
    { queryKey: queryKeys.tasks.all },
    (old) => {
      if (!old?.pages) return old
      return {
        ...old,
        pages: old.pages.map((page) => ({
          ...page,
          tasks: page.tasks.map((t) => (t.id === taskId ? patch(t) : t)),
        })),
      }
    },
  )
}
