'use client'

import { useLocale, useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { formatCurrency, formatCurrencyRounded } from '@/lib/i18n/numberFormat'
import type { FinanceCurrency } from '@/queries/finance'

/**
 * The one figure the page exists to state: what left this month.
 *
 * Rounded to the major unit. A six-figure sum rendered to the cent spends its
 * two most prominent characters on precision nobody reads at a glance, and every
 * row underneath still carries the exact amount.
 */
export function MoneyHero({ block }: { block: FinanceCurrency }) {
  const t = useTranslations('money')
  const locale = useLocale()

  const { spentThisMonthMinor: now, spentLastMonthMinor: before, currency } = block

  // Only stated when there is a real prior month to compare against. "Up 100%"
  // from a month with no data is arithmetic, not information — and it is the
  // shape of claim that makes a user stop believing the rest of the page.
  const delta = before > 0 ? Math.round(((now - before) / before) * 100) : null

  return (
    <section aria-labelledby="money-hero-total" className="flex flex-col gap-5 px-5">
      <div className="flex flex-col gap-1.5">
        <h2 id="money-hero-total" className="text-micro uppercase tracking-[0.08em] text-ink-muted">
          {t('hero.thisMonth')}
        </h2>

        <p className="tabular font-display text-display-hero leading-[0.95] text-ink">
          {formatCurrencyRounded(now, currency, locale)}
        </p>

        {delta === null ? (
          <p className="text-body-sm text-ink-muted">{t('hero.noComparison')}</p>
        ) : (
          <p className="text-body-sm text-ink-muted">
            {t(delta >= 0 ? 'hero.upOnLastMonth' : 'hero.downOnLastMonth', {
              percent: Math.abs(delta),
              amount: formatCurrency(before, currency, locale),
            })}
          </p>
        )}
      </div>

      {/* Obligations, not history — the half of the page that is still actionable.
          Overdue takes the accent because it is the only figure here that is
          already late; a strip where every number shouts tells you nothing.

          TWO tiles, not a three-up strip. StatStrip is built for bare counts, and
          three formatted amounts ("EGP 17,973") collide and clip at 375px. The
          window total that used to sit here was the one worth dropping: the trend
          chart directly below already IS that number, drawn. */}
      <div className="grid grid-cols-2 gap-3">
        <ObligationTile
          amount={formatCurrencyRounded(block.overdueMinor, currency, locale)}
          label={t('hero.overdue')}
          live={block.overdueMinor > 0}
        />
        <ObligationTile
          amount={formatCurrencyRounded(block.upcomingMinor, currency, locale)}
          label={t('hero.upcoming')}
          live={false}
        />
      </div>
    </section>
  )
}

/**
 * One obligation figure in a tile.
 *
 * <p>Local rather than <c>StatTile</c> deliberately: that primitive's contract is
 * a bare COUNT, and its 32px display size is chosen for "5" or "12". A formatted
 * amount is three times as many glyphs and clips out of a half-width card at
 * that scale, so this drops to the 24px heading step and keeps the tile's own
 * geometry, wash and caption identical.</p>
 */
function ObligationTile({
  amount,
  label,
  live,
}: {
  amount: string
  label: string
  /** Coral is reserved for what is actually late. Nothing overdue is not an alert. */
  live: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-2xl px-5 py-4',
        live ? 'bg-accent-soft' : 'bg-surface-sunken',
      )}
    >
      <span
        className={cn(
          'tabular truncate font-display text-heading-xl leading-none',
          live ? 'text-accent' : 'text-ink',
        )}
      >
        {amount}
      </span>
      <span className="text-micro uppercase tracking-[0.08em] text-ink-muted">{label}</span>
    </div>
  )
}
