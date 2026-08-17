'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { DomainBreakdown } from '@/components/money/DomainBreakdown'
import { MoneyEntryList } from '@/components/money/MoneyEntryList'
import { MoneyHero } from '@/components/money/MoneyHero'
import { SpendTrend } from '@/components/money/SpendTrend'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { env } from '@/lib/env'
import { FINANCE_WINDOWS, type FinanceEntry, type FinanceSummary, type FinanceWindow } from '@/queries/finance'

/**
 * The whole money screen below the header.
 *
 * <p>Layout only — it takes a resolved summary and renders it, so the preview
 * route can mount the identical tree against fixtures. Loading, error and empty
 * are the page's job, not this component's.</p>
 */
export function MoneyView({
  summary,
  months,
  onMonthsChange,
  onSelectEntry,
}: {
  summary: FinanceSummary
  months: FinanceWindow
  onMonthsChange: (next: FinanceWindow) => void
  onSelectEntry?: (entry: FinanceEntry) => void
}) {
  const t = useTranslations('money')

  // Currencies arrive busiest-first, so index 0 is the one the user's life
  // mostly happens in. Held by CODE rather than index: a refetch can reorder the
  // list, and an index would silently switch which currency is on screen.
  const [active, setActive] = useState(summary.currencies[0]?.currency ?? '')
  const block = summary.currencies.find((c) => c.currency === active) ?? summary.currencies[0]

  if (!block) return null

  return (
    <div className="flex flex-col gap-8 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5">
        {/* SegmentedControl keys on strings, so the window crosses the boundary
            as one and is narrowed back through FINANCE_WINDOWS — which keeps the
            allowed set in a single place rather than restating it as a cast. */}
        <SegmentedControl
          label={t('window.label')}
          value={String(months)}
          onChange={(next) => {
            const chosen = FINANCE_WINDOWS.find((w) => String(w) === next)
            if (chosen) onMonthsChange(chosen)
          }}
          segments={FINANCE_WINDOWS.map((w) => ({
            value: String(w),
            label: t('window.months', { months: w }),
          }))}
        />

        {/* Shown only when there is a choice to make. A one-option control is
            chrome that teaches the user nothing. */}
        {summary.currencies.length > 1 ? (
          <SegmentedControl
            label={t('currency.label')}
            value={block.currency}
            onChange={setActive}
            segments={summary.currencies.map((c) => ({ value: c.currency, label: c.currency }))}
          />
        ) : null}
      </div>

      <MoneyHero block={block} />

      <SpendTrend block={block} />

      <section aria-labelledby="money-upcoming" className="flex flex-col gap-3 px-5">
        <h2 id="money-upcoming" className="font-display text-heading-serif text-ink">
          {t('upcoming.title')}
        </h2>
        <MoneyEntryList
          entries={block.upcoming}
          currency={block.currency}
          emptyLabel={t('upcoming.empty')}
          onSelect={onSelectEntry}
        />
      </section>

      <DomainBreakdown block={block} />

      <section aria-labelledby="money-largest" className="flex flex-col gap-3 px-5">
        <h2 id="money-largest" className="font-display text-heading-serif text-ink">
          {t('largest.title')}
        </h2>
        <MoneyEntryList
          entries={block.largest}
          currency={block.currency}
          emptyLabel={t('largest.empty')}
          onSelect={onSelectEntry}
        />
      </section>

      <CoverageNote summary={summary} multiCurrency={summary.currencies.length > 1} />
    </div>
  )
}

/**
 * What the page could not see, stated plainly.
 *
 * <p>This is the most important paragraph on the screen. Every total above it is
 * built from documents a vision pass happened to find a figure on; presented
 * alone they read as "your spending" when they are "what the system could see".
 * It is deliberately body copy under the totals rather than an icon or a
 * tooltip — a caveat nobody opens is a caveat nobody was given.</p>
 */
function CoverageNote({
  summary,
  multiCurrency,
}: {
  summary: FinanceSummary
  multiCurrency: boolean
}) {
  const t = useTranslations('money')
  const { documentsTotal, documentsWithAmount, mattersWithAmount } = summary.coverage

  return (
    <section className="flex flex-col gap-1.5 px-5 pb-4">
      {/* Silent when there are no documents at all. The sentence exists to say
          how much of the DOCUMENT pile the reader is seeing, and with an empty
          pile every phrasing of it is absurd — "no amount was found in any of
          your 0 documents" reads as a fault report about nothing. The matters
          line below still carries the real provenance. */}
      {documentsTotal > 0 ? (
        <p className="text-body-sm text-ink-muted">
          {documentsWithAmount === 0
            ? t('coverage.none', { total: documentsTotal })
            : t('coverage.partial', {
                withAmount: documentsWithAmount,
                total: documentsTotal,
                app: env.appName,
              })}
        </p>
      ) : null}

      {mattersWithAmount > 0 ? (
        <p className="text-body-sm text-ink-muted">
          {t('coverage.matters', { count: mattersWithAmount })}
        </p>
      ) : null}

      {multiCurrency ? (
        <p className="text-body-sm text-ink-muted">{t('currency.note')}</p>
      ) : null}
    </section>
  )
}
