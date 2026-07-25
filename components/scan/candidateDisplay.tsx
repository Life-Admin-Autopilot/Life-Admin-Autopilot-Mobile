// Shared display bits for a scan candidate / filed task — used by both the
// editable review list (ScanReviewCard) and the read-only summary
// (TaskOverview) so the two stay visually consistent.

import { cn } from '@/lib/cn'
import type { ScanCandidateDomain, ScanCandidatePriority } from '@/queries/documentScans'

// A summary sentence Mo wrote (per-document or per-item) — plain, no icon,
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
export const DOMAIN_LABEL: Record<ScanCandidateDomain, string> = {
  health: 'Health',
  home: 'Home',
  car: 'Car',
  finance: 'Finance',
  family: 'Family',
  pets: 'Pets',
}

export function formatDue(iso?: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const PRIORITY_STYLE: Record<'urgent' | 'high' | 'low', string> = {
  urgent: 'bg-danger-soft text-danger',
  high: 'bg-warning-soft text-warning',
  low: 'bg-surface-sunken text-ink-subtle',
}
const PRIORITY_LABEL: Record<'urgent' | 'high' | 'low', string> = {
  urgent: 'Urgent',
  high: 'High priority',
  low: 'Low priority',
}

export function PriorityPill({ priority }: { priority: ScanCandidatePriority }) {
  if (priority === 'normal') return null
  return (
    <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-xs uppercase', PRIORITY_STYLE[priority])}>
      {PRIORITY_LABEL[priority]}
    </span>
  )
}
