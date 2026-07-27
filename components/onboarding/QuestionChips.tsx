'use client'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'

// A quick-pick choice chip. Unselected floats on the canvas as a soft white
// pill; selected fills coral. No outlines in either state.
export function ChoiceChip({
  label,
  selected,
  onClick,
}: {
  label: string
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-pill px-4 py-2.5 text-body-sm font-bold transition-colors active:scale-[0.98]',
        selected ? 'bg-accent text-accent-ink' : 'bg-surface text-ink shadow-card',
      )}
    >
      {label}
    </button>
  )
}

// A domain toggle chip — emoji chip + label, coral fill when selected.
export function DomainChip({
  domain,
  label,
  selected,
  onClick,
}: {
  domain: Domain
  label: string
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-pill py-1.5 pl-1.5 pr-4 text-body-sm font-bold transition-colors active:scale-[0.98]',
        selected ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink',
      )}
    >
      <DomainIcon domain={domain} size={34} />
      {label}
    </button>
  )
}
