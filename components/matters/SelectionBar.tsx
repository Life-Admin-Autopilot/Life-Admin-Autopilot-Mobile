'use client'

import { motion } from 'framer-motion'
import { Check, Clock, Sparkles, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'

// Matters' half of selection mode: the bottom action bar. The header half is
// the shared SelectionToolbar in components/ui — /documents wears the same one.
//
// This takes the tab bar's exact footprint at the bottom of the device, and
// every action carries a WORD, not just a glyph.
//
// What it replaces was one floating pill holding all of it: "All", a count, and
// four unlabelled icons crammed together. Two problems, both real. The bar was
// `absolute` inside a scrolling page, so it came to rest over the middle of the
// list instead of the bottom of the device (overlays here are ALWAYS `fixed` —
// PhoneFrame's transform is what breaks `absolute`). And a bare row of icons
// next to a destructive one asks the user to guess: an unlabelled trash beside
// an unlabelled clock is how people delete things they meant to snooze.

// Deliberately the same geometry as TabBar (`fixed inset-x-0 bottom-safe`, centred
// `max-w-sm` pill) so it reads as the tab bar becoming the action bar rather
// than a second bar landing on top of one. The tab bar itself slides away
// underneath — see lib/tabBarStore.ts.
export function SelectionActionBar({
  count,
  onComplete,
  onSnooze,
  onCategorize,
  onDelete,
  busy = false,
}: {
  count: number
  onComplete: () => void
  onSnooze: () => void
  /** Receives the button's rect so the review sheet morphs out of it. */
  onCategorize: (rect: DOMRect) => void
  /** Receives the button's rect so the confirm sheet morphs out of it. */
  onDelete: (rect: DOMRect) => void
  busy?: boolean
}) {
  const disabled = busy || count === 0

  return (
    <motion.div
      initial={{ y: 96, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 96, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      className="bottom-safe fixed inset-x-0 z-40 mx-auto flex max-w-sm items-center justify-around rounded-pill bg-surface/95 px-2 py-2 shadow-elevated backdrop-blur-xl"
    >
      <Action label="Complete" onClick={onComplete} disabled={disabled}>
        <Check size={20} />
      </Action>
      <Action label="Snooze" onClick={onSnooze} disabled={disabled}>
        <Clock size={20} />
      </Action>
      {/* Sits between the reversible actions and the destructive one, because
          that is what it is: it proposes, nothing is written until reviewed,
          and an applied run undoes like any other. */}
      <Action label="File" onClick={onCategorize} disabled={disabled}>
        <Sparkles size={20} />
      </Action>
      <Action label="Delete" onClick={onDelete} disabled={disabled} danger>
        <Trash2 size={20} />
      </Action>
    </motion.div>
  )
}

function Action({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: (rect: DOMRect) => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'flex w-20 flex-col items-center gap-0.5 rounded-pill py-1.5 transition-colors active:scale-95 disabled:opacity-30',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {children}
      <span className="text-tab">{label}</span>
    </button>
  )
}
