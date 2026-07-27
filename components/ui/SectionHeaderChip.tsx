'use client'

import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/cn'

// Group headers. The tint is the grouping dimension made visible — time of
// day, priority, or domain — so a scrolled list still tells you where you are
// without re-reading the label.
export type ChipTone =
  | 'anytime'
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'high'
  | 'medium'
  | 'low'

const TONE: Record<ChipTone, string> = {
  anytime: 'bg-bucket-anytime text-ink',
  morning: 'bg-bucket-morning text-ink',
  afternoon: 'bg-bucket-afternoon text-ink',
  evening: 'bg-bucket-evening text-ink',
  high: 'bg-priority-high-soft text-priority-high',
  medium: 'bg-priority-med-soft text-priority-med',
  low: 'bg-priority-low-soft text-priority-low',
}

export function SectionHeaderChip({
  label,
  tone = 'anytime',
  count,
  icon,
  open,
  onToggle,
  className,
}: {
  label: string
  tone?: ChipTone
  count?: number
  icon?: React.ReactNode
  /** Omit both `open` and `onToggle` for a static, non-collapsing header. */
  open?: boolean
  onToggle?: () => void
  className?: string
}) {
  const collapsible = typeof open === 'boolean' && Boolean(onToggle)

  const body = (
    <>
      {icon}
      <span className="text-label uppercase">{label}</span>
      {typeof count === 'number' ? (
        <span className="text-label tabular opacity-60">{count}</span>
      ) : null}
      {collapsible ? (
        <ChevronDown
          size={15}
          className={cn('ml-0.5 transition-transform', !open && '-rotate-90')}
        />
      ) : null}
    </>
  )

  const classes = cn(
    'inline-flex items-center gap-2 rounded-pill px-3.5 py-1.5',
    TONE[tone],
    className,
  )

  if (!collapsible) return <span className={classes}>{body}</span>

  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className={classes}>
      {body}
    </button>
  )
}
