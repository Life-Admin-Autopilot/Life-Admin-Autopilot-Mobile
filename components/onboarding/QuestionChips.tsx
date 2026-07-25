'use client'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'

// A quick-pick choice chip — selected = purple wash + hairline.
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
        'rounded-pill border px-4 py-2 text-body-sm transition-colors',
        selected
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-border bg-surface text-ink hover:bg-surface-sunken',
      )}
    >
      {label}
    </button>
  )
}

// A domain toggle chip — stone DomainIcon + label, purple wash when selected.
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
        'flex w-full items-center gap-2.5 rounded-pill border border-transparent py-2 pl-2 pr-4 text-body-sm transition-colors',
        selected
          ? 'bg-accent text-white'
          : 'bg-surface-sunken text-ink-muted hover:bg-surface-sunken/70',
      )}
    >
      <DomainIcon domain={domain} size={30} className="rounded-full" />
      {label}
    </button>
  )
}
