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
  /**
   * A model is writing a better `headline` for this day right now.
   *
   * The server answers the dashboard with a computed count sentence immediately
   * and asks the model for a real one in the background — a language model on
   * the critical path of the home screen's first paint is not a trade worth
   * making for prose. This flag is how the sentence gets collected: while it is
   * true the query refetches, and the improved headline arrives in place.
   *
   * It is an assertion that a write is actually in flight, so it goes false on
   * a failed generation as well as a successful one, and is never true on a
   * server with no model configured. Optional because an older server does not
   * send it — absent reads as "nothing coming", which is the safe default.
   */
  prosePending?: boolean
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
    // Wait for the sentence, and only for as long as one is coming.
    //
    // Gated on the server's own claim rather than on a timer or a retry count:
    // it is the only party that knows whether a model was asked, and it drops
    // the flag on failure as well as on success. A client that instead polled
    // "until the headline changes" would poll forever on the day the model was
    // unavailable — and that day is precisely the day the plain count is all
    // there is.
    refetchInterval: (query) => (query.state.data?.prosePending ? PROSE_POLL_MS : false),
  })
}

/**
 * How often to check back while the model is writing.
 *
 * Two seconds because the request is a single short generation against a warm
 * key, not a chat turn — most land on the first or second check. Tighter would
 * spend requests on a wait the user is not watching a spinner for; looser is a
 * home screen that keeps its placeholder sentence noticeably too long.
 */
const PROSE_POLL_MS = 2_000
