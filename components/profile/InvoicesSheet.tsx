'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/Sheet'
import { useInvoices } from '@/queries/billing'

// Billing history. Today the endpoint is a deliberate stub returning `[]`, so
// the empty state is the state — which is exactly why it is designed rather
// than left as a blank panel. The list rendering below is real and will light
// up unchanged the moment a payment provider starts filling that array.

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
}

export function InvoicesSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const t = useTranslations('profile.plan')
  const tCommon = useTranslations('common')
  const tGroups = useTranslations('profile.groups')
  const { data, isPending, isError, refetch } = useInvoices()
  const invoices = data?.invoices ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={380}
      eyebrow={tGroups('plan')}
      title={t('invoicesTitle')}
    >
      {isPending ? (
        <ul className="flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-2xl bg-surface-sunken" />
          ))}
        </ul>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-display text-heading-serif text-ink">{t('invoicesLoadFailed')}</p>
          <Button variant="secondary" size="pill" onClick={() => void refetch()}>
            {tCommon('tryAgain')}
          </Button>
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="font-display text-heading-serif text-ink">{t('noInvoices')}</p>
          <p className="max-w-[30ch] text-body text-ink-muted">
            You&rsquo;re on the free plan, so there&rsquo;s nothing to bill.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-heading-sm tabular text-ink">
                  {formatAmount(invoice.amountCents, invoice.currency)}
                </span>
                <span className="text-body-sm text-ink-muted">
                  {new Date(invoice.issuedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
              {invoice.url ? (
                <a
                  href={invoice.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-pill px-3 py-1.5 text-caption text-accent hover:bg-accent-soft"
                >
                  Receipt
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
