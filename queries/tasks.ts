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

export const DOMAIN_LABEL: Record<TaskDomain, string> = {
  health: 'Health',
  home: 'Home',
  car: 'Car',
  finance: 'Finance',
  family: 'Family',
  pets: 'Pets',
}

export interface Subtask {
  id: string
  text: string
  done: boolean
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
  sourceVoiceNoteId?: string
  sourceDocumentId?: string
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

export const SORT_LABEL: Record<TaskSort, string> = {
  'due-asc': 'Due soonest',
  'due-desc': 'Due latest',
  'created-desc': 'Newest first',
  'created-asc': 'Oldest first',
  'priority-desc': 'Priority',
  'title-asc': 'A–Z',
}

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
function invalidateTasks(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.all })
  void qc.invalidateQueries({ queryKey: queryKeys.notifications })
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

export function useAddSubtask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, text }: { taskId: string; text: string }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks`, {
        method: 'POST',
        body: { text },
      }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useToggleSubtask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      taskId,
      subtaskId,
      done,
    }: {
      taskId: string
      subtaskId: string
      done: boolean
    }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'PATCH',
        body: { done },
      }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
}

export function useRemoveSubtask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, subtaskId }: { taskId: string; subtaskId: string }) =>
      api<{ task: Task }>(`/me/tasks/${taskId}/subtasks/${subtaskId}`, {
        method: 'DELETE',
      }).then((r) => r.task),
    onSuccess: () => invalidateTasks(qc),
  })
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
