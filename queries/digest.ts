// The daily digest — one cached read the dashboard makes on every visit.
//
// A `useQuery`, unlike the Matters range summary in queries/mattersAi.ts, which
// is a mutation. The difference is deliberate: the server caches this per local
// day and only regenerates when the underlying matters actually change, so a
// refocus refetch is cheap and the dashboard can hold it like any other read.
//
// Every number in here is computed server-side from real matters. Only
// `headline` and the theme labels are written by the model — see
// server/src/modules/tasks/dailyDigest.ts.

import { useQuery } from '@tanstack/react-query'

import { api, toQuery } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'

export interface DigestCounts {
  dueToday: number
  completedToday: number
  openTotal: number
  slipping: number
  /** Open clarifications awaiting an answer. */
  needsInput: number
  /** Scanned documents sitting in review. */
  scansAwaitingReview: number
}

export interface DigestTheme {
  label: string
  count: number
  taskIds: string[]
}

export interface DigestDuplicate {
  title: string
  count: number
  taskIds: string[]
}

export interface DailyDigest {
  /** Local calendar date the digest describes, 'YYYY-MM-DD'. */
  localDate: string
  generatedAt: string
  /** One sentence. The only free prose the model writes. */
  headline: string
  counts: DigestCounts
  /** Summed from today's matter estimates. Zeros when nothing is estimated. */
  estimatedMinutesToday: { min: number; max: number }
  themes: DigestTheme[]
  busiestDay: { date: string; count: number } | null
  duplicates: DigestDuplicate[]
}

// Day boundaries are meaningless without the caller's zone, and the server
// caches per local date — so tz is part of the key, not just the URL. Resolved
// per call rather than memoized: a device that crosses a timezone should get
// the new day's digest on the next fetch.
function tz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function useDigest() {
  const timezone = tz()
  return useQuery({
    queryKey: queryKeys.digest(timezone),
    queryFn: () =>
      api<{ digest: DailyDigest }>(`/me/digest${toQuery({ tz: timezone })}`).then(
        (r) => r.digest,
      ),
    // The server rebuilds only when the user's matters change, so a short
    // client stale window costs at most one cheap cached round trip.
    staleTime: 60_000,
  })
}
