// Display and grouping helpers for matters.
//
// The bucket boundaries here MUST match server/src/modules/tasks/taskQuery.ts
// (`dayBoundaries`) — the header badge comes from the server's counts and the
// section headers come from this file, and a user noticing "TODAY 3" above two
// rows loses confidence in everything else on the screen.

import {
  formatDayMonth,
  formatDayMonthMaybeYear,
  formatFullDate,
  formatTime,
  formatWeekday,
} from '@/lib/i18n/dateFormat'
import type { Translate } from '@/lib/i18n/translate'
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

// The bucket names are also the message keys under `matters.bucket.*`.
//
// "Overdue", not "Slipped" — the two are different sets and the app shows both
// on /matters at once: this header counts everything past its date, while the
// banner above it counts what taskCounts calls SLIPPING (moved three times, or
// a fortnight gone). Labelling both "Slipped" put "4 matters have slipped"
// three rows above "SLIPPED 17", which reads as a bug in the counting rather
// than as two different questions. The rows under this header already say
// "8 days overdue", so the header agrees with its own contents.
//
// Note for translators: the same distinction has to survive in Arabic —
// `matters.bucket.overdue` (متأخرة) and the slipped-matters nudge must not
// collapse into the same word.

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
  /** Also the message key suffix — `matters.bucket.<key>` / `matters.priority.<key>`. */
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
export type BucketKey = `bucket.${TimeBucket}`

export function groupByTime(
  tasks: Task[],
  t: Translate<BucketKey>,
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
    label: t(`bucket.${b}`),
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

export type PriorityKey = `priority.${TaskPriority}`

export function groupByPriority(tasks: Task[], t: Translate<PriorityKey>): TaskGroup[] {
  const order: TaskPriority[] = ['urgent', 'high', 'normal', 'low']
  return order
    .map((p) => ({
      key: p,
      label: t(`priority.${p}`),
      tasks: tasks.filter((task) => task.priority === p),
    }))
    .filter((g) => g.tasks.length > 0)
}

// ---- Dates ----

const MS_DAY = 24 * 60 * 60 * 1000

// Short, human due label. Deliberately relative near today and absolute beyond
// it — "in 3 days" is harder to act on than "Fri" once you're planning.
export type DueKey =
  | 'due.noDate'
  | 'due.today'
  | 'due.todayOverdue'
  | 'due.tomorrow'
  | 'due.yesterday'
  | 'due.daysOverdue'
  | 'due.overdueSince'

export interface DueFormatContext {
  /** Scoped to the `matters` namespace. */
  t: Translate<DueKey>
  /** Intl tag — `ar-u-nu-latn`, not `ar`. From `useIntlTag()`. */
  tag: string
  now?: Date
}

export function formatDue(iso: string | undefined, ctx: DueFormatContext): string {
  const { t, tag } = ctx
  const now = ctx.now ?? new Date()

  if (!iso) return t('due.noDate')
  const due = new Date(iso)
  if (Number.isNaN(due.getTime())) return t('due.noDate')

  const todayStart = startOfDay(now)
  const dayDelta = Math.round((startOfDay(due).getTime() - todayStart.getTime()) / MS_DAY)
  const time = formatTime(due, tag)

  if (dayDelta === 0) {
    return due < now ? t('due.todayOverdue', { time }) : t('due.today', { time })
  }
  if (dayDelta === 1) return t('due.tomorrow', { time })
  if (dayDelta === -1) return t('due.yesterday', { time })
  if (dayDelta < 0) {
    const days = Math.abs(dayDelta)
    // ICU plural, not `${days} days` — Arabic selects across six categories
    // (zero/one/two/few/many/other) and "2 يوم" is wrong where "يومان" is right.
    return days < 30
      ? t('due.daysOverdue', { count: days })
      : t('due.overdueSince', { date: formatDayMonth(due, tag) })
  }
  if (dayDelta < 7) return formatWeekday(due, tag)
  return formatDayMonthMaybeYear(due, now, tag)
}

export type RangeKey = 'range.between' | 'range.after' | 'range.before' | 'range.allTime'

// Absolute, unambiguous range label for destructive confirmations. Never
// relative: "last month" is exactly the phrasing that makes a bulk delete go
// wrong, so the confirm card always spells the dates out.
export function formatRange(
  from: string | undefined,
  to: string | undefined,
  ctx: { t: Translate<RangeKey>; tag: string },
): string {
  const fmt = (iso: string) => formatFullDate(new Date(iso), ctx.tag)
  if (from && to) return ctx.t('range.between', { from: fmt(from), to: fmt(to) })
  if (from) return ctx.t('range.after', { date: fmt(from) })
  if (to) return ctx.t('range.before', { date: fmt(to) })
  return ctx.t('range.allTime')
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
  /**
   * Message key under `matters.snooze.*`. Rendered by the caller, which holds
   * the translate function — these lists are module constants and cannot.
   *
   * A literal union, not `string`: next-intl checks keys at compile time, so
   * `t(`snooze.${labelKey}`)` only resolves to a real key if the type carries
   * the exact members. Widening this to `string` silently disables that check
   * for every preset.
   */
  labelKey: 'laterToday' | 'tomorrow' | 'nextWeek' | 'nextMonth'
  at: (now: Date) => Date
}

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { labelKey: 'laterToday', at: (n) => new Date(n.getTime() + 4 * 60 * 60 * 1000) },
  {
    labelKey: 'tomorrow',
    at: (n) => {
      const d = addDays(startOfDay(n), 1)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    labelKey: 'nextWeek',
    at: (n) => {
      const d = addDays(startOfDay(n), 7)
      d.setHours(9, 0, 0, 0)
      return d
    },
  },
  {
    labelKey: 'nextMonth',
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
  /** Message key under `matters.range.preset.*`. Literal union for the same
   *  compile-time-key reason as SnoozePreset.labelKey. */
  labelKey: 'today' | 'thisWeek' | 'thisMonth' | 'nextMonth'
  range: (now: Date) => { dueAfter?: string; dueBefore?: string }
}

export const RANGE_PRESETS: RangePreset[] = [
  {
    labelKey: 'today',
    range: (n) => ({
      dueAfter: startOfDay(n).toISOString(),
      dueBefore: addDays(startOfDay(n), 1).toISOString(),
    }),
  },
  {
    labelKey: 'thisWeek',
    range: (n) => ({
      dueAfter: startOfDay(n).toISOString(),
      dueBefore: addDays(startOfDay(n), 7).toISOString(),
    }),
  },
  {
    labelKey: 'thisMonth',
    range: (n) => {
      const start = startOfDay(n)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      return { dueAfter: start.toISOString(), dueBefore: end.toISOString() }
    },
  },
  {
    labelKey: 'nextMonth',
    range: (n) => {
      const start = startOfDay(n)
      start.setMonth(start.getMonth() + 1)
      const end = new Date(start)
      end.setMonth(end.getMonth() + 1)
      return { dueAfter: start.toISOString(), dueBefore: end.toISOString() }
    },
  },
]
