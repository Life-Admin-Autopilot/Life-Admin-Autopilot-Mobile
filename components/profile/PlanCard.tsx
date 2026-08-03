'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { useAiQuota } from '@/queries/ai'
import { useDocumentScanQuota } from '@/queries/documentScanQuota'
import { useSubscription } from '@/queries/billing'
import { Button } from '@/components/ui/button'

// What your plan is, and what you have actually used on it.
//
// The meters read from the same endpoints that enforce the limits, so the
// numbers here cannot drift from the gate that blocks an upload. Showing real
// usage is the honest version of a pricing page: it says what you get and where
// you are against it, instead of asking you to guess whether you need more.

function Meter({
  label,
  used,
  limit,
  pro,
}: {
  label: string
  used: number
  limit: number
  pro: boolean
}) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0
  // Coral is "live". A meter running out is exactly that, so it stays coral
  // rather than turning red — this is a limit, not a failure.
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-body-sm text-ink">{label}</span>
        <span className="text-body-sm tabular text-ink-muted">
          {used} / {limit}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-surface-sunken">
        <div
          className={cn('h-full rounded-pill transition-[width]', pro ? 'bg-gold' : 'bg-accent')}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  )
}

function MeterSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="h-4 w-1/3 animate-pulse rounded-pill bg-surface-sunken" />
      <div className="h-2 animate-pulse rounded-pill bg-surface-sunken" />
    </div>
  )
}

export function PlanCard({ onSeePro }: { onSeePro: (rect: DOMRect) => void }) {
  const t = useTranslations('profile.plan')
  const subscription = useSubscription()
  const aiQuota = useAiQuota()
  const scanQuota = useDocumentScanQuota()

  const tier = subscription.data?.subscription.tier ?? 'free'
  const pro = tier === 'pro'
  const renewsAt = subscription.data?.subscription.renewsAt

  const aiRow = aiQuota.data?.quotas.find((q) => q.kind === 'message')
  const scan = scanQuota.data?.quota

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl px-5 py-5',
        // Gold is reserved for the premium tier and used nowhere else in the
        // app — which is what makes it read as premium when it appears.
        pro ? 'bg-gold-soft' : 'bg-surface shadow-card',
      )}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className={cn('font-display text-heading-serif', pro ? 'text-gold' : 'text-ink')}>
          {pro ? 'Pro' : 'Free'}
        </span>
        {pro && renewsAt ? (
          <span className="text-caption tabular text-ink-muted">
            Renews {new Date(renewsAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-3.5">
        {aiQuota.isPending ? (
          <MeterSkeleton />
        ) : aiRow ? (
          <Meter label={t('aiToday')} used={aiRow.used} limit={aiRow.limit} pro={pro} />
        ) : null}

        {scanQuota.isPending ? (
          <MeterSkeleton />
        ) : scan ? (
          <Meter label={t('scansMonth')} used={scan.used} limit={scan.limit} pro={pro} />
        ) : null}

        {aiQuota.isError && scanQuota.isError ? (
          <p className="text-body-sm text-ink-muted">{t('usageUnavailable')}</p>
        ) : null}
      </div>

      {!pro ? (
        <Button
          variant="secondary"
          className="w-full"
          onClick={(e) => onSeePro(e.currentTarget.getBoundingClientRect())}
        >
          See what Pro adds
        </Button>
      ) : null}
    </div>
  )
}
