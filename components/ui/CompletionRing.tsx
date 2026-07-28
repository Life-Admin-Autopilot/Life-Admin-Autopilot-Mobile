'use client'

import { Check } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/cn'

// The done-state affordance: an open ring that fills near-black and draws a
// check on tap. Deliberately NOT coral — completing something is a settled
// fact, and coral is reserved for what is currently live.
export function CompletionRing({
  checked,
  onChange,
  label,
  size = 28,
  className,
}: {
  checked: boolean
  onChange?: (next: boolean) => void
  /** Accessible name, e.g. the matter's title. */
  label: string
  size?: number
  className?: string
}) {
  const reduced = useReducedMotion()
  const interactive = Boolean(onChange)

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={!interactive}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onChange?.(!checked)
      }}
      style={{ width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-2 transition-colors',
        checked ? 'border-solid bg-solid text-solid-ink' : 'border-ink-subtle text-transparent',
        interactive && 'active:scale-95 disabled:pointer-events-none',
        className,
      )}
    >
      <motion.span
        initial={false}
        animate={checked ? { scale: 1, opacity: 1 } : { scale: 0.4, opacity: 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 26 }}
        className="grid place-items-center"
      >
        <Check size={Math.round(size * 0.55)} strokeWidth={3} />
      </motion.span>
    </button>
  )
}

// Bulk-select / review affordance. Larger, and unchecked reads as an empty
// well rather than an outline so a screen full of them stays quiet.
export function SelectionCheck({
  checked,
  label,
  size = 32,
  className,
}: {
  checked: boolean
  label?: string
  size?: number
  className?: string
}) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      style={{ width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full border-2 transition-colors',
        checked
          ? 'border-solid bg-solid text-solid-ink'
          : 'border-border-strong text-transparent',
        className,
      )}
    >
      <Check size={Math.round(size * 0.5)} strokeWidth={3} />
    </span>
  )
}

/**
 * The switch as pure appearance — a `<span>`, so it can live inside a control
 * that is itself the switch. A settings row wants its whole 44px-tall body to
 * be the hit target, and HTML forbids nesting a button inside a button, so the
 * row owns `role="switch"` and renders this for the look. `Toggle` below is the
 * same visual with its own button around it, for standalone use.
 */
export function SwitchVisual({ checked, className }: { checked: boolean; className?: string }) {
  const reduced = useReducedMotion()
  return (
    <span
      aria-hidden
      className={cn(
        'relative block h-7 w-12 shrink-0 rounded-pill p-0.5 transition-colors',
        checked ? 'bg-accent' : 'bg-border-strong',
        className,
      )}
    >
      <motion.span
        layout
        initial={false}
        animate={{ x: checked ? 20 : 0 }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 620, damping: 34 }}
        className="block size-6 rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/.15)]"
      />
    </span>
  )
}

// iOS-style switch. ON is coral: a setting that is on is a live state.
export function Toggle({
  checked,
  onChange,
  label,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('shrink-0 rounded-pill', className)}
    >
      <SwitchVisual checked={checked} />
    </button>
  )
}
