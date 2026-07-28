// Display and grouping helpers for matters.
//
// The bucket boundaries here MUST match server/src/modules/tasks/taskQuery.ts
// (`dayBoundaries`) — the header badge comes from the server's counts and the
// section headers come from this file, and a user noticing "TODAY 3" above two
// rows loses confidence in everything else on the screen.

import type { Task, TaskDomain, TaskPriority } from '@/queries/tasks'

export const TIME_BUCKETS = [
  'overdue',
  'today',
  'tomorrow',
  'thisWeek',
  'later',
  'undated',
  'done',
] as const
export type TimeBucket = (typeof TIME_BUCKETS)[number]

// "Overdue", not "Slipped".
//
// The two are different sets and the app shows both on /matters at once: this
// header counts everything past its date, while the banner above it counts
// what taskCounts calls SLIPPING — moved three times, or a fortnight gone.
// Labelling both "Slipped" put "4 matters have slipped" three rows above
// "SLIPPED 17", which reads as a bug in the counting rather than as two
// different questions. "Slipped" now means only the strict signal; the rows
// under this header already say "8 days overdue", so the header agrees with
// its own contents.
export const BUCKET_LABEL: Record<TimeBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  thisWeek: 'This week',
  later: 'Later',
  undated: 'No date',
  done: 'Done',
}

function startOfDay(at: Date): Date {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(at: Date, days: number): Date {
  const d = new Date(at)
  d.setDate(d.getDate() + days)
  return d
}

export function bucketOf(task: Task, now: Date = new Date()): TimeBucket {
  if (task.status === 'done') return 'done'
  if (!task.dueAt) return 'undated'

  const due = new Date(task.dueAt)
  if (Number.isNaN(due.getTime())) return 'undated'
  if (due < now) return 'overdue'

  const todayStart = startOfDay(now)
  if (due < addDays(todayStart, 1)) return 'today'
  if (due < addDays(todayStart, 2)) return 'tomorrow'
  if (due < addDays(todayStart, 7)) return 'thisWeek'
  return 'later'
}

export interface TaskGroup {
  key: string
  label: string
  tasks: Task[]
}

// Group into time buckets, preserving the server's sort inside each. Empty
// buckets are dropped — an empty "Overdue" header is a small accusation.
//
// `pinned` overrides the computed bucket per task id. Completing a matter flips
// its bucket to `done`, which would otherwise rip the row out of the section
// the user was looking at and drop it in a "Done" pile at the foot of the list
// — the row vanishes from under the finger that just ticked it. Callers holding
// a just-completed row on screen pin it to the bucket it was in beforehand so it
// goes struck-through in place.
export function groupByTime(
  tasks: Task[],
  now: Date = new Date(),
  pinned?: ReadonlyMap<string, TimeBucket>,
): TaskGroup[] {
  const bins = new Map<TimeBucket, Task[]>()
  for (const task of tasks) {
    const bucket = pinned?.get(task.id) ?? bucketOf(task, now)
    const bin = bins.get(bucket)
    if (bin) bin.push(task)
    else bins.set(bucket, [task])
  }
  return TIME_BUCKETS.filter((b) => (bins.get(b)?.length ?? 0) > 0).map((b) => ({
    key: b,
    label: BUCKET_LABEL[b],
    tasks: bins.get(b) ?? [],
  }))
}

export function groupByDomain(
  tasks: Task[],
  labels: Record<TaskDomain, string>,
): TaskGroup[] {
  const bins = new Map<TaskDomain, Task[]>()
  for (const task of tasks) {
    const bin = bins.get(task.domain)
    if (bin) bin.push(task)
    else bins.set(task.domain, [task])
  }
  return [...bins.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([domain, group]) => ({ key: domain, label: labels[domain], tasks: group }))
}

const PRIORITY_GROUP_LABEL: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  normal: 'Normal',
  low: 'Low',
}

export function groupByPriority(tasks: Task[]): TaskGroup[] {
  const order: TaskPriority[] = ['urgent', 'high', 'normal', 'low']
  return order
    .map((p) => ({
      key: p,
      label: PRIORITY_GROUP_LABEL[p],
      tasks: tasks.filter((t) => t.priority === p),
    }))
    .filter((g) => g.tasks.length > 0)
}

// ---- Dates ----

const MS_DAY = 24 * 60 * 60 * 1000

// Short, human due label. Deliberately relative near today and absolute beyond
// it — "in 3 days" is harder to act on than "Fri" once you're planning.
export function formatDue(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return 'No date'
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return 'No date'

  const todayStart = startOfDay(now)
  const dayDelta = Math.round((startOfDay(due).getTime() - todayStart.getTime()) / MS_DAY)
  const time = due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

  if (dayDelta === 0) return due < now ? `Today, ${time} · overdue` : `Today, ${time}`
  if (dayDelta === 1) return `Tomorrow, ${time}`
  if (dayDelta === -1) return `Yesterday, ${time}`
  if (dayDelta < 0) {
    const days = Math.abs(dayDelta)
    return days < 30
      ? `${days} days overdue`
      : `Overdue since ${due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  }
  if (dayDelta < 7) return due.toLocaleDateString(undefined, { weekday: 'long' })
  return due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(due.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

// Absolute, unambiguous range label for destructive confirmations. Never
// relative: "last month" is exactly the phrasing that makes a bulk delete go
// wrong, so the confirm card always spells the dates out.
export function formatRange(from: string | undefined, to: string | undefined): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  if (from && to) return `${fmt(from)} – ${fmt(to)}`
  if (from) return `from ${fmt(from)}`
  if (to) return `up to ${fmt(to)}`
  return 'all time'
}

// <input type="datetime-local"> speaks local wall-clock with no zone; the API
// speaks UTC ISO. These two convert between them.
export function toLocalInputValue(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInputValue(v: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// ---- Snooze presets ----

export interface SnoozePreset {
  label: string
  at: (now: Date) => Date
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { label: 'Later today', at: (n) => new Date(n.getTime() + 4 * 60 * 60 * 1000) },
  {
    label: 'Tomorrow',
    at: (n) => {
      const d = addDays(startOfDay(n), 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    label: 'Next week',
    at: (n) => {
      const d = addDays(startOfDay(n), 7)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    label: 'Next month',
    at: (n) => {
      const d = startOfDay(n)
      d.setMonth(d.getMonth() + 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
]

// ---- Date-range presets for the filter sheet ----

export interface RangePreset {
  label: string
  range: (now: Date) => { dueAfter?: string; dueBefore?: string }
}

export const RANGE_PRESETS: RangePreset[] = [
  {
    label: 'Today',
    range: (n) => ({
      dueAfter: startOfDay(n).toISOString(),
      dueBefore: addDays(startOfDay(n), 1).toISOString(),
    }),
  },
  {
    label: 'This week',
    range: (n) => ({
      dueAfter: startOfDay(n).toISOString(),
      dueBefore: addDays(startOfDay(n), 7).toISOString(),
    }),
  },
  {
    label: 'This month',
    range: (n) => {
      const start = startOfDay(n)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      return { dueAfter: start.toISOString(), dueBefore: end.toISOString() }
    },
  },
  {
    label: 'Next month',
    range: (n) => {
      const start = startOfDay(n)
      start.setMonth(start.getMonth() + 1)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      return { dueAfter: start.toISOString(), dueBefore: end.toISOString() }
    },
  },
]
