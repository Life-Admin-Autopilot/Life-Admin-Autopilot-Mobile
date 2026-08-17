'use client'

import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'

import { formatCurrencyRounded } from '@/lib/i18n/numberFormat'
import { useFinanceSummary } from '@/queries/finance'

/**
 * The dashboard's way in to /money.
 *
 * <p>Two facts and a door: what left this month, and whether anything is late.
 * The tab bar is full at five slots, so this card is how the money surface is
 * discovered at all — which is also why it renders nothing until there is a real
 * figure to show. A card reading "0" on an account that has never scanned a bill
 * teaches the user the feature is empty rather than that it is waiting.</p>
 */
export function MoneyCard() {
  const t = useTranslations('money')
  const locale = useLocale()

  // The dashboard's own reads stay untouched by this one: a failure here removes
  // the card, it never takes the page down with it.
  const { data: summary } = useFinanceSummary(6)

  const block = summary?.currencies[0]
  if (!block) return null

  const outstanding =
    block.overdueMinor > 0
      ? t('card.overdue', {
          amount: formatCurrencyRounded(block.overdueMinor, block.currency, locale),
        })
      : block.upcomingMinor > 0
        ? t('card.upcoming', {
            amount: formatCurrencyRounded(block.upcomingMinor, block.currency, locale),
          })
        : t('card.settled')

  return (
    <Link
      href="/money"
      aria-label={t('card.open')}
      className="flex items-center gap-4 rounded-2xl bg-surface px-5 py-4 shadow-card transition-transform active:scale-[0.99]"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-micro uppercase tracking-[0.08em] text-ink-muted">
          {t('card.thisMonth')}
        </span>

        <span className="tabular font-display text-display-md leading-none text-ink">
          {formatCurrencyRounded(block.spentThisMonthMinor, block.currency, locale)}
        </span>

        {/* Coral only when something is actually late — the one live fact on the
            card. Everything settled reads in muted ink, because "nothing is
            wrong" is not an alert. */}
        <span
          className={
            block.overdueMinor > 0 ? 'text-body-sm text-accent' : 'text-body-sm text-ink-muted'
          }
        >
          {outstanding}
        </span>
      </span>

      <ChevronRight size={20} strokeWidth={1.75} className="shrink-0 text-ink-muted rtl:rotate-180" />
    </Link>
  )
}
