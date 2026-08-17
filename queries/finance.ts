// The financial summary read.
//
// One endpoint, no writes. Every figure it returns was stored by the document
// scan pass or typed onto a matter, so this layer never has to reconcile a cache
// after a mutation — the amounts change when matters and scans do, and those
// slices already invalidate themselves.

import { useQuery } from '@tanstack/react-query'

import { api, toQuery } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import type { TaskDomain } from '@/queries/tasks'

/**
 * Where a figure came from. `ai` earns a provenance marker on screen; `user`
 * does not, because the person typed it themselves.
 */
export type MoneySource = 'ai' | 'user'

/** `matter` opens the matter sheet, `document` the document viewer. */
export type FinanceEntryKind = 'matter' | 'document'

export interface FinanceMonth {
  /** `YYYY-MM`. A label, already bucketed in the user's timezone — never re-parse it. */
  month: string
  spentMinor: number
  count: number
}

export interface FinanceDomainBreakdown {
  domain: TaskDomain
  spentMinor: number
  count: number
}

export interface FinanceEntry {
  id: string
  kind: FinanceEntryKind
  title: string
  domain?: TaskDomain
  amountMinor: number
  source: MoneySource
  /** When it happened, or falls due. Absent on an undated obligation. */
  at?: string
  overdue: boolean
}

/**
 * One currency's whole picture.
 *
 * Currencies are never combined — there is no exchange-rate source in this
 * product, so a single total across two currencies could only be invented. A
 * user with EGP and USD documents gets two of these.
 */
export interface FinanceCurrency {
  currency: string
  spentThisMonthMinor: number
  spentLastMonthMinor: number
  spentWindowMinor: number
  /** Refunds and rebates. Reported alongside spending, never subtracted from it. */
  receivedWindowMinor: number
  overdueMinor: number
  overdueCount: number
  upcomingMinor: number
  upcomingCount: number
  byMonth: FinanceMonth[]
  byDomain: FinanceDomainBreakdown[]
  largest: FinanceEntry[]
  upcoming: FinanceEntry[]
}

/**
 * What the summary could NOT see.
 *
 * The totals are built from documents a vision pass happened to find a figure
 * on. Rendering them without this would state "your spending" about money the
 * system never saw, so the page shows it as a plain sentence rather than hiding
 * it behind a tooltip.
 */
export interface FinanceCoverage {
  documentsTotal: number
  documentsWithAmount: number
  mattersWithAmount: number
}

export interface FinanceSummary {
  months: number
  /** The IANA zone the months were bucketed in. Echoed so this side never re-buckets. */
  timezone: string
  generatedAt: string
  /** Busiest currency first. */
  currencies: FinanceCurrency[]
  coverage: FinanceCoverage
}

export const FINANCE_WINDOWS = [3, 6, 12] as const
export type FinanceWindow = (typeof FINANCE_WINDOWS)[number]

export function useFinanceSummary(months: FinanceWindow = 6) {
  return useQuery({
    queryKey: queryKeys.financeSummary(months),
    queryFn: () =>
      api<{ finance: FinanceSummary }>(`/me/finance/summary${toQuery({ months })}`),
    // Aggregation over rows that only change when a scan lands or a matter is
    // ticked off. A minute of staleness costs nothing and spares the recompute
    // on every back-navigation to the page.
    staleTime: 60_000,
    select: (data) => data.finance,
  })
}

/**
 * Whether there is anything to show at all.
 *
 * Not the same as "no documents": an account can hold forty scans and still have
 * no readable figure in any of them, and those two states want different words
 * on screen.
 */
export function hasAnyMoney(summary: FinanceSummary | undefined): boolean {
  return (summary?.currencies.length ?? 0) > 0
}
