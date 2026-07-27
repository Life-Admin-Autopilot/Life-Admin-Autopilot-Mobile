'use client'

import { cn } from '@/lib/cn'

// Selection mode's header row, split the way iOS Mail / Files split it: Cancel
// on the left, the live count in the middle, select-all on the right.
//
// It sits in the sticky control row IN PLACE OF that screen's own controls, so
// entering selection doesn't shift the list under the user's finger. Both
// states are one `h-10` line for exactly that reason — do not let either grow.
//
// Shared rather than per-screen: /matters and /documents both select, and two
// copies of this row is how the two screens end up disagreeing about what the
// select-all button is called.
export function SelectionToolbar({
  count,
  allSelected,
  onSelectAll,
  onCancel,
  subject,
}: {
  count: number
  allSelected: boolean
  onSelectAll: () => void
  onCancel: () => void
  /** Plural noun for the empty prompt — "matters", "documents". */
  subject: string
}) {
  return (
    <div className="flex h-10 items-center justify-between gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-pill px-2 py-1 text-body-sm font-bold text-accent hover:bg-accent-soft"
      >
        Cancel
      </button>

      {/* Reads as a sentence, not a badge: "Select documents" tells a user who
          just entered the mode what to do next, where "0 selected" reads like
          something failed. */}
      <span
        aria-live="polite"
        className={cn(
          'min-w-0 truncate text-body-sm tabular',
          count > 0 ? 'font-bold text-ink' : 'text-ink-muted',
        )}
      >
        {count === 0 ? `Select ${subject}` : count === 1 ? '1 selected' : `${count} selected`}
      </span>

      <button
        type="button"
        onClick={onSelectAll}
        className="shrink-0 rounded-pill px-2 py-1 text-body-sm font-bold text-accent hover:bg-accent-soft"
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>
    </div>
  )
}
