'use client'

// Shared display bits for a scan candidate / filed task — used by both the
// editable review list (ScanReviewCard) and the read-only summary
// (TaskOverview) so the two stay visually consistent.

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { cn } from '@/lib/cn'
import type { ScanCandidateDomain, ScanCandidatePriority } from '@/queries/documentScans'

// A summary sentence Kitto wrote (per-document or per-item) — plain, no icon,
// no tinted box: a small muted eyebrow and the sentence itself rendered bold
// and legible, not tucked away as if it were secondary metadata.
export function SummaryNote({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5 mb-4', className)}>
      <p className="text-body font-semibold leading-snug text-ink">{text}</p>
    </div>
  )
}

export const DOMAINS: ScanCandidateDomain[] = ['health', 'home', 'car', 'finance', 'family', 'pets']

// `intlTag` rather than `undefined`: the browser's own locale is not the app's
// — someone reading Arabic on an English phone must still get an Arabic month
// name. Passed in because this is a plain function, not a hook; every caller
// already reads useIntlTag() for its own formatting.
export function formatDue(iso: string | undefined, intlTag: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString(intlTag, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The four priority names, for the chip rows in review and edit. */
export function usePriorityLabels(): Record<ScanCandidatePriority, string> {
  const t = useTranslations('scan')
  return useMemo(
    () => ({
      low: t('priority.low'),
      normal: t('priority.normal'),
      high: t('priority.high'),
      urgent: t('priority.urgent'),
    }),
    [t],
  )
}

const PRIORITY_STYLE: Record<'urgent' | 'high' | 'low', string> = {
  urgent: 'bg-danger-soft text-danger',
  high: 'bg-warning-soft text-warning',
  low: 'bg-surface-sunken text-ink-subtle',
}

export function PriorityPill({ priority }: { priority: ScanCandidatePriority }) {
  const t = useTranslations('scan')
  if (priority === 'normal') return null
  // Spelled out per case rather than built from a template so each label is a
  // whole phrase in the catalogue — "high" and "priority" do not compose into
  // an Arabic noun phrase in that order.
  const label =
    priority === 'urgent'
      ? t('priorityPill.urgent')
      : priority === 'high'
        ? t('priorityPill.high')
        : t('priorityPill.low')
  return (
    <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-xs uppercase', PRIORITY_STYLE[priority])}>
      {label}
    </span>
  )
}
