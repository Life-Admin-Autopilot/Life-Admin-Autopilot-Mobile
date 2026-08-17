'use client'

import { useLocale, useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { formatCurrency, formatCurrencyRounded } from '@/lib/i18n/numberFormat'
import type { FinanceCurrency } from '@/queries/finance'

/** Shortest month name in the reader's language — "Aug", "أغس". */
function monthLabel(key: string, locale: string): string {
  // `key` is `YYYY-MM`, already bucketed server-side in the user's timezone. Day
  // 1 at noon UTC is far enough from either boundary that no zone shifts it into
  // an adjacent month on the way to a label.
  const [year, month] = key.split('-').map(Number)
  const at = new Date(Date.UTC(year, month - 1, 1, 12))
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(at)
}

/**
 * Six months of outgoings as one shape.
 *
 * <p>Bars are sized by inline height and never animated — motion on a layout
 * property is banned outright, and a chart that grows on every render draws the
 * eye to the animation rather than the trend.</p>
 *
 * <p>Empty months are rendered as empty bars rather than skipped. A trend that
 * omits its zeroes puts two non-adjacent months side by side and reads as
 * continuity that did not happen.</p>
 */
export function SpendTrend({ block }: { block: FinanceCurrency }) {
  const t = useTranslations('money')
  const locale = useLocale()

  const peak = Math.max(...block.byMonth.map((m) => m.spentMinor), 1)

  return (
    <section aria-labelledby="money-trend" className="flex flex-col gap-3 px-5">
      <h2 id="money-trend" className="font-display text-heading-serif text-ink">
        {t('trend.title')}
      </h2>

      <div className="rounded-2xl bg-surface px-4 py-4 shadow-card">
        {/* A table, not a div grid: the figures ARE tabular data, and a screen
            reader gets the months and their amounts paired without the chart
            having to duplicate them into aria-labels. */}
        <table className="w-full">
          <caption className="sr-only">{t('trend.caption')}</caption>
          <tbody>
            {/* `items-stretch`, not `items-end`. Ending the row's alignment
                collapses each cell to its content height, and a percentage
                height on the bar inside then resolves against zero — the chart
                renders as an empty white box. The cells stretch to the row's
                fixed height and each one bottom-aligns its own bar instead. */}
            <tr className="flex h-32 items-stretch gap-1.5">
              {block.byMonth.map((month) => {
                const isPeak = month.spentMinor === peak && peak > 1
                return (
                  <td key={month.month} className="flex flex-1 flex-col justify-end">
                    <span
                      // Minimum 2px so an empty month is still a visible tick on
                      // the baseline rather than a gap the eye reads as missing.
                      style={{ height: `${Math.max((month.spentMinor / peak) * 100, 2)}%` }}
                      className={cn(
                        'w-full rounded-t-lg rounded-b-sm',
                        isPeak ? 'bg-accent' : 'bg-accent-soft',
                      )}
                    />
                  </td>
                )
              })}
            </tr>

            <tr className="mt-2 flex gap-1.5">
              {block.byMonth.map((month) => (
                <th
                  key={month.month}
                  scope="col"
                  className="flex-1 text-center text-micro font-normal text-ink-muted"
                >
                  <span aria-hidden>{monthLabel(month.month, locale)}</span>
                  <span className="sr-only">
                    {monthLabel(month.month, locale)}:{' '}
                    {formatCurrency(month.spentMinor, block.currency, locale)}
                  </span>
                </th>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {block.receivedWindowMinor > 0 ? (
        // Refunds are reported, never netted off the bars above — subtracting
        // them would make the headline disagree with the rows the user can see.
        <p className="text-body-sm text-ink-muted">
          {t('trend.received', {
            amount: formatCurrencyRounded(block.receivedWindowMinor, block.currency, locale),
          })}
        </p>
      ) : null}
    </section>
  )
}
