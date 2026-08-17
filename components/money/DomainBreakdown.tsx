'use client'

import { useLocale, useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { formatCurrency } from '@/lib/i18n/numberFormat'
import type { FinanceCurrency } from '@/queries/finance'

/**
 * Which parts of a life the money went to.
 *
 * <p>A proportion bar per row rather than a pie: six slices at these sizes are
 * unreadable on a 390px screen, and a bar keeps the domain marks — the signature
 * of the system — as the thing you scan down.</p>
 *
 * <p>Only matters carry a domain. Documents that were never filed into one are
 * absent here and said so by the coverage note, rather than being lumped into an
 * "Other" bucket that would look like a real category.</p>
 */
export function DomainBreakdown({ block }: { block: FinanceCurrency }) {
  const t = useTranslations('money')
  const tDomain = useTranslations('domain')
  const locale = useLocale()

  const peak = Math.max(...block.byDomain.map((d) => d.spentMinor), 1)

  return (
    <section aria-labelledby="money-domains" className="flex flex-col gap-3 px-5">
      <h2 id="money-domains" className="font-display text-heading-serif text-ink">
        {t('domains.title')}
      </h2>

      {block.byDomain.length === 0 ? (
        <p className="px-1 text-body-sm text-ink-muted">{t('domains.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {block.byDomain.map((row) => (
            <li
              key={row.domain}
              className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card"
            >
              <DomainIcon domain={row.domain} size={40} />

              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-body text-ink">{tDomain(row.domain)}</span>
                  <span className="tabular shrink-0 text-body font-semibold text-ink">
                    {formatCurrency(row.spentMinor, block.currency, locale)}
                  </span>
                </span>

                {/* Proportional to the LARGEST row, not to the total: at six
                    domains every bar would otherwise be a sliver, and the
                    comparison the eye actually makes here is row against row. */}
                <span className="flex h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
                  <span
                    style={{ width: `${(row.spentMinor / peak) * 100}%` }}
                    className="rounded-pill bg-accent"
                  />
                </span>

                <span className="text-micro text-ink-muted">
                  {t('domains.count', { count: row.count })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
