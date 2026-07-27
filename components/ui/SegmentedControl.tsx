'use client'

import { cn } from '@/lib/cn'

export interface Segment<T extends string> {
  value: T
  label: string
}

// Sunken track, raised white thumb. The active segment looks like it is
// sitting on top of the track rather than merely tinted.
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
  className,
}: {
  segments: ReadonlyArray<Segment<T>>
  value: T
  onChange: (next: T) => void
  /** Accessible name for the group. */
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-pill bg-surface-sunken p-1', className)}
    >
      {segments.map((s) => {
        const active = s.value === value
        return (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s.value)}
            className={cn(
              'rounded-pill px-4 py-1.5 text-body-sm font-bold transition-colors',
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
            )}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
