// The AI layer for the Matters workspace: natural-language search compilation
// and the time-range summary.
//
// Both are mutations, not queries — they are user-initiated, they cost a quota
// slot, and their result is a thing the user then acts on. Caching them by key
// would silently re-run them on refocus.

import { useMutation } from '@tanstack/react-query'

import { api } from '@/lib/api/client'
import type { Task } from '@/queries/tasks'

function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

// Search by description. The server returns the matching matters themselves,
// ranked by relevance, plus a sentence describing what was found — not a filter
// for the client to go and run.
export interface SearchMatch {
  task: Task
  /** Short clause saying why this one qualified. */
  reason: string
}

export interface SearchResult {
  answer: string
  matches: SearchMatch[]
  /** The pool was capped, so the answer may not have seen every matter. */
  truncated: boolean
}

export function useSearchMatters() {
  return useMutation({
    mutationFn: (query: string) =>
      api<SearchResult>('/me/tasks/search', {
        method: 'POST',
        body: { query, timezone: tz() },
      }),
  })
}

export interface SummaryTheme {
  label: string
  count: number
  taskIds: string[]
  examples: string[]
}

export interface TaskSummary {
  range: { from: string; to: string }
  counts: {
    dueInRange: number
    completedInRange: number
    createdInRange: number
    completedPrevious: number
    stillOpen: number
    overdue: number
  }
  themes: SummaryTheme[]
  slipping: { taskId: string; title: string; reason: string }[]
  duplicates: { title: string; count: number; taskIds: string[] }[]
  unplannedCompleted: { taskId: string; title: string }[]
  busiestDay: { date: string; count: number } | null
  headline: string
  question: { text: string; taskId: string | null } | null
}

export function useSummarize() {
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      api<{ summary: TaskSummary }>('/me/tasks/summarize', {
        method: 'POST',
        body: { from, to, timezone: tz() },
      }).then((r) => r.summary),
  })
}

// Ranges the summary offers by default. "Next month" is the one the user asked
// for by name; the others are the questions people actually ask next.
export interface SummaryRange {
  /** Catalogue key under `matters.range.preset`, not a display string.
   *
   *  Same reason as SnoozePreset.labelKey in lib/taskFormat.ts: this module is a
   *  data layer and cannot call a hook, and naming the four keys as a literal
   *  union is what makes `t(`range.preset.${labelKey}`)` resolve to a real key
   *  at compile time. Three of the four already existed for the filter sheet's
   *  due-range chips — this const reads them rather than restating them. */
  labelKey: 'thisWeek' | 'thisMonth' | 'nextMonth' | 'lastMonth'
  range: (now: Date) => { from: string; to: string }
}

function startOfDay(at: Date): Date {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d
}

function addMonths(at: Date, months: number): Date {
  const d = new Date(at)
  d.setMonth(d.getMonth() + months)
  return d
}

export const SUMMARY_RANGES: SummaryRange[] = [
  {
    labelKey: 'thisWeek',
    range: (n) => {
      const from = startOfDay(n)
      const to = new Date(from)
      to.setDate(to.getDate() + 7)
      return { from: from.toISOString(), to: to.toISOString() }
    },
  },
  {
    labelKey: 'thisMonth',
    range: (n) => ({
      from: startOfDay(n).toISOString(),
      to: addMonths(startOfDay(n), 1).toISOString(),
    }),
  },
  {
    labelKey: 'nextMonth',
    range: (n) => ({
      from: addMonths(startOfDay(n), 1).toISOString(),
      to: addMonths(startOfDay(n), 2).toISOString(),
    }),
  },
  {
    labelKey: 'lastMonth',
    range: (n) => ({
      from: addMonths(startOfDay(n), -1).toISOString(),
      to: startOfDay(n).toISOString(),
    }),
  },
]
