'use client'

import { useLocale, useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Pill } from '@/components/ui/Pill'
import { formatDayMonthMaybeYear } from '@/lib/i18n/dateFormat'
import { formatCurrency } from '@/lib/i18n/numberFormat'
import type { FinanceEntry } from '@/queries/finance'

/**
 * A list of priced things — "still to pay" and "largest" are the same row with a
 * different sort, so they are the same component.
 *
 * <p>Every AI-read figure carries a provenance marker. That is the trust
 * contract, not decoration: an extracted amount that renders identically to one
 * the user typed gives them no way to know which number to double-check, and one
 * wrong figure they trusted costs the product every figure after it.</p>
 */
export function MoneyEntryList({
  entries,
  currency,
  emptyLabel,
  onSelect,
}: {
  entries: readonly FinanceEntry[]
  currency: string
  emptyLabel: string
  onSelect?: (entry: FinanceEntry) => void
}) {
  const t = useTranslations('money')
  const locale = useLocale()

  if (entries.length === 0) {
    return <p className="px-1 text-body-sm text-ink-muted">{emptyLabel}</p>
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {entries.map((entry) => {
        const row = (
          <>
            {/* A document has no domain, so it gets the generic finance mark
                rather than an invented category. */}
            <DomainIcon domain={entry.domain ?? 'finance'} size={40} />

            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body text-ink">{entry.title}</span>

              <span className="flex items-center gap-1.5">
                {entry.overdue ? (
                  <Pill tone="warning">{t('upcoming.overdue')}</Pill>
                ) : (
                  <span className="text-body-sm text-ink-muted">
                    {entry.at
                      ? formatDayMonthMaybeYear(new Date(entry.at), new Date(), locale)
                      : t('upcoming.undated')}
                  </span>
                )}

                {entry.source === 'ai' ? (
                  <Pill tone="field">{t('provenance.short')}</Pill>
                ) : null}
              </span>
            </span>

            <span className="tabular shrink-0 text-body font-semibold text-ink">
              {formatCurrency(entry.amountMinor, currency, locale)}
            </span>
          </>
        )

        return (
          <li key={`${entry.kind}-${entry.id}`}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(entry)}
                className="flex w-full items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-start shadow-card transition-transform active:scale-[0.99]"
              >
                {row}
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card">
                {row}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
