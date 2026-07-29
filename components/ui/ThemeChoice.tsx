'use client'

import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

// The appearance picker: three tiles, each a miniature of the theme it selects.
//
// This replaced a Light/Dark/System segmented control, which had two problems.
// The active segment was a white pill on a near-white track, so on the light
// theme you could barely tell which one was on — the one thing the control
// exists to say. And three words cannot show what they mean; a picker for how
// the app LOOKS should look like the thing it picks.
//
// So each tile renders a tiny canvas-with-a-card, in that theme's real colours,
// and System splits diagonally to say "whichever your phone is". Selection is
// coral — the app's "live/selected" colour — plus a check, so it never depends
// on hue alone.

export type ThemeChoiceValue = 'light' | 'dark' | 'system'

const OPTIONS: ReadonlyArray<{ value: ThemeChoiceValue; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/**
 * A miniature of the app: canvas, a card carrying two text bars and a coral
 * dot. Small enough to read as an impression rather than a screenshot.
 */
function Mock({ tone }: { tone: 'light' | 'dark' }) {
  const light = tone === 'light'
  return (
    <div
      className={cn(
        'flex size-full flex-col justify-center gap-1.5 p-2.5',
        light ? 'bg-theme-light-canvas' : 'bg-theme-dark-canvas',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-md px-1.5 py-1.5',
          light ? 'bg-theme-light-surface' : 'bg-theme-dark-surface',
        )}
      >
        <span className="size-2.5 shrink-0 rounded-full bg-accent" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              'block h-1 w-full rounded-full',
              light ? 'bg-theme-light-ink' : 'bg-theme-dark-ink',
            )}
          />
          <span
            className={cn(
              'block h-1 w-2/3 rounded-full',
              light ? 'bg-theme-light-ink' : 'bg-theme-dark-ink',
            )}
          />
        </span>
      </div>
      <div
        className={cn(
          'h-1 w-1/2 rounded-full',
          light ? 'bg-theme-light-ink' : 'bg-theme-dark-ink',
        )}
      />
    </div>
  )
}

function Preview({ value }: { value: ThemeChoiceValue }) {
  if (value === 'system') {
    // Light underneath, dark clipped to the far diagonal half. A hard split
    // rather than a gradient — "it follows your phone" is a switch, not a blend.
    return (
      <div className="relative size-full">
        <Mock tone="light" />
        <div
          className="absolute inset-0"
          style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        >
          <Mock tone="dark" />
        </div>
      </div>
    )
  }
  return <Mock tone={value} />
}

export function ThemeChoice({
  value,
  onChange,
  className,
}: {
  value: ThemeChoiceValue
  onChange: (next: ThemeChoiceValue) => void
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn('flex gap-3', className)}>
      {OPTIONS.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className="group flex flex-1 flex-col items-center gap-2 rounded-2xl outline-none"
          >
            <span
              className={cn(
                'relative block h-20 w-full overflow-hidden rounded-xl shadow-card transition-all',
                // The ring sits outside the box, so the tile never resizes on
                // selection and the row cannot jitter as you tap across it.
                selected
                  ? 'ring-2 ring-accent ring-offset-2 ring-offset-canvas'
                  : 'ring-1 ring-border-strong group-hover:ring-ink-subtle',
                'group-focus-visible:ring-3 group-focus-visible:ring-ring/40',
              )}
            >
              <Preview value={option.value} />
              {selected ? (
                <span className="absolute bottom-1.5 end-1.5 grid size-5 place-items-center rounded-full bg-accent text-accent-ink">
                  <Check size={12} strokeWidth={3} />
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'text-body-sm transition-colors',
                selected ? 'font-bold text-accent' : 'text-ink-muted',
              )}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
