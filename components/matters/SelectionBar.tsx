'use client'

import { motion } from 'framer-motion'
import { Check, Clock, Trash2 } from 'lucide-react'

import { cn } from '@/lib/cn'

// Selection mode, split the way iOS Mail / Files split it — and for the reasons
// they split it:
//
//   SelectionToolbar   sits in the sticky header IN PLACE OF the filter row.
//                      Cancel on the left, the live count in the middle, select
//                      -all on the right. It occupies the same single row the
//                      controls did, so entering selection doesn't shift the
//                      list under the user's finger.
//
//   SelectionActionBar takes the tab bar's exact footprint at the bottom of the
//                      device. Every action carries a WORD, not just a glyph.
//
// What this replaces was one floating pill holding all of it: "All", a count,
// and four unlabelled icons crammed together. Two problems, both real. The bar
// was `absolute` inside a scrolling page, so it came to rest over the middle of
// the list instead of the bottom of the device (overlays here are ALWAYS
// `fixed` — PhoneFrame's transform is what breaks `absolute`). And a bare row of
// icons next to a destructive one asks the user to guess: an unlabelled trash
// beside an unlabelled clock is how people delete things they meant to snooze.
//
// The count still never scrolls away — that was the right call, and the sticky
// header keeps it true.

export function SelectionToolbar({
  count,
  allSelected,
  onSelectAll,
  onCancel,
}: {
  count: number
  allSelected: boolean
  onSelectAll: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-pill px-1 text-caption text-accent"
      >
        Cancel
      </button>

      {/* Reads as a sentence, not a badge: "nothing selected" tells a user who
          just entered the mode what to do next, where "0 selected" reads like
          something failed. */}
      <span
        aria-live="polite"
        className={cn(
          'min-w-0 truncate text-caption tabular',
          count > 0 ? 'font-medium text-ink' : 'text-ink-subtle',
        )}
      >
        {count === 0 ? 'Select matters' : count === 1 ? '1 selected' : `${count} selected`}
      </span>

      <button
        type="button"
        onClick={onSelectAll}
        className="shrink-0 rounded-pill px-1 text-caption text-accent"
      >
        {allSelected ? 'Deselect All' : 'Select All'}
      </button>
    </div>
  )
}

// Deliberately the same geometry as TabBar (`fixed inset-x-0 bottom-4`, centred
// `max-w-sm` pill) so it reads as the tab bar becoming the action bar rather
// than a second bar landing on top of one. The tab bar itself slides away
// underneath — see lib/tabBarStore.ts.
export function SelectionActionBar({
  count,
  onComplete,
  onSnooze,
  onDelete,
  busy = false,
}: {
  count: number
  onComplete: () => void
  onSnooze: () => void
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
      className="fixed inset-x-0 bottom-4 z-40 mx-auto flex max-w-sm items-center justify-around rounded-pill border border-border bg-surface/95 px-2 py-2 shadow-elevated backdrop-blur"
    >
      <Action label="Complete" onClick={onComplete} disabled={disabled}>
        <Check size={20} />
      </Action>
      <Action label="Snooze" onClick={onSnooze} disabled={disabled}>
        <Clock size={20} />
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
        'flex w-20 flex-col items-center gap-0.5 rounded-pill py-1 transition-colors disabled:opacity-30',
        danger ? 'text-danger' : 'text-ink-muted',
      )}
    >
      {children}
      <span className="text-micro">{label}</span>
    </button>
  )
}
