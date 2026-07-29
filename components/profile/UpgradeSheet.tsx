'use client'

import { Check } from 'lucide-react'

import { Sheet } from '@/components/ui/Sheet'
import { useAiQuota } from '@/queries/ai'
import { useDocumentScanQuota } from '@/queries/documentScanQuota'

// What Pro would add — and, plainly, that you cannot buy it yet.
//
// There is no payment provider wired up, so there is no Buy button here. A
// disabled one, or one that opens a checkout that fails, would be worse than
// saying the true thing: the tier exists, the limits are real, and the door is
// not open. When a provider lands this sheet grows a CTA and nothing else about
// it changes.

// The free-tier numbers come from the live quota endpoints, so this comparison
// cannot go stale against the limits the server actually enforces. The Pro
// numbers mirror the server's *_PRO_* env defaults.
const PRO_AI_DAILY = 300
const PRO_SCANS_MONTHLY = 200

function Row({ label, free, pro }: { label: string; free: string; pro: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1 text-body-sm text-ink">{label}</span>
      <span className="w-16 shrink-0 text-end text-body-sm tabular text-ink-muted">{free}</span>
      <span className="w-16 shrink-0 text-end text-body-sm tabular font-bold text-gold">{pro}</span>
    </li>
  )
}

export function UpgradeSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const aiQuota = useAiQuota()
  const scanQuota = useDocumentScanQuota()

  const freeAi = aiQuota.data?.quotas.find((q) => q.kind === 'message')?.limit
  const freeScans = scanQuota.data?.quota.limit

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={440}
      eyebrow="Plan"
      title="What Pro adds"
    >
      <ul className="flex flex-col divide-y divide-border">
        <li className="flex items-center gap-3 pb-2">
          <span className="min-w-0 flex-1" />
          <span className="w-16 shrink-0 text-end text-label uppercase text-ink-muted">Free</span>
          <span className="w-16 shrink-0 text-end text-label uppercase text-gold">Pro</span>
        </li>
        <Row
          label="AI questions a day"
          free={freeAi ? String(freeAi) : '—'}
          pro={String(PRO_AI_DAILY)}
        />
        <Row
          label="Document scans a month"
          free={freeScans ? String(freeScans) : '—'}
          pro={String(PRO_SCANS_MONTHLY)}
        />
      </ul>

      <ul className="mt-4 flex flex-col gap-2">
        {['Everything in Free', 'Longer voice notes', 'Priority document processing'].map((item) => (
          <li key={item} className="flex items-center gap-2 text-body-sm text-ink-muted">
            <Check size={15} className="shrink-0 text-gold" />
            {item}
          </li>
        ))}
      </ul>

      <p className="mt-5 rounded-2xl bg-surface-sunken px-4 py-3.5 text-body-sm text-ink-muted">
        Pro isn&rsquo;t open yet. We&rsquo;ll let you know when it is.
      </p>
    </Sheet>
  )
}
