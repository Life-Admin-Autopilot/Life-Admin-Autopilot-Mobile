'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AppHeader } from '@/components/layout/AppHeader'
import { MoneyView } from '@/components/money/MoneyView'
import { Button } from '@/components/ui/button'
import { useVoiceCapture } from '@/lib/voice/captureStore'
import { hasAnyMoney, useFinanceSummary, type FinanceEntry, type FinanceWindow } from '@/queries/finance'

/**
 * Money — what left, what is still owed, and what the system could not see.
 *
 * <p>Data container only; the layout lives in MoneyView. Branches on
 * `isLoading`/`error` rather than on `data` truthiness, so an account with
 * genuinely no amounts gets the designed empty state instead of a spinner that
 * never resolves.</p>
 */
export default function MoneyPage() {
  const t = useTranslations('money')
  const router = useRouter()
  const openCapture = useVoiceCapture((s) => s.openCapture)

  const [months, setMonths] = useState<FinanceWindow>(6)
  const { data: summary, isLoading, error } = useFinanceSummary(months)

  // A row leads back to the thing it was read off, which is what makes an
  // extracted figure checkable rather than merely labelled.
  function openEntry(entry: FinanceEntry) {
    router.push(entry.kind === 'document' ? '/documents' : '/matters')
  }

  return (
    // pb-32 clears the floating tab bar, matching every other screen that wears
    // it. /money is opened from a dashboard card, so the bar stays with Home lit
    // and the header carries a back puck home — see ROUTE_PARENT_TAB.
    <main className="min-h-dvh pb-32">
      <AppHeader title={t('title')} backTo="/dashboard" />

      {isLoading ? <MoneySkeleton label={t('states.loading')} /> : null}

      {error ? (
        <section className="flex flex-col items-center gap-3 px-5 pt-16 text-center">
          <h2 className="font-display text-heading-serif text-ink">{t('states.errorTitle')}</h2>
          <p className="text-body-sm text-ink-muted">{t('states.errorBody')}</p>
          {/* A refetch, not a reload: the rest of the app's caches are fine. */}
          <Button variant="solid" onClick={() => router.refresh()}>
            {t('states.errorTitle')}
          </Button>
        </section>
      ) : null}

      {!isLoading && !error && !hasAnyMoney(summary) ? (
        <section className="flex flex-col items-center gap-3 px-5 pt-16 text-center">
          <h2 className="font-display text-heading-serif text-ink">{t('states.emptyTitle')}</h2>
          <p className="max-w-xs text-body-sm text-ink-muted">{t('states.emptyBody')}</p>
          <Button variant="solid" onClick={openCapture}>
            {t('states.emptyAction')}
          </Button>
        </section>
      ) : null}

      {summary && hasAnyMoney(summary) ? (
        <MoneyView
          summary={summary}
          months={months}
          onMonthsChange={setMonths}
          onSelectEntry={openEntry}
        />
      ) : null}
    </main>
  )
}

/** Matches the real shape — hero, strip, chart, two lists — not a generic spinner. */
function MoneySkeleton({ label }: { label: string }) {
  return (
    <div aria-busy aria-label={label} className="flex animate-pulse flex-col gap-8 px-5 pt-6">
      <div className="flex flex-col gap-3">
        <span className="h-3 w-28 rounded-pill bg-surface-sunken" />
        <span className="h-12 w-52 rounded-lg bg-surface-sunken" />
        <span className="h-3 w-40 rounded-pill bg-surface-sunken" />
      </div>

      <span className="h-24 rounded-2xl bg-surface-sunken" />
      <span className="h-40 rounded-2xl bg-surface-sunken" />

      <div className="flex flex-col gap-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-16 rounded-2xl bg-surface-sunken" />
        ))}
      </div>
    </div>
  )
}
