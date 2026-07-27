'use client'

import { motion } from 'framer-motion'
import { Trash2 } from 'lucide-react'

// The bottom bar for /documents selection mode. Same geometry as matters'
// SelectionActionBar (`fixed inset-x-0 bottom-safe`, centred `max-w-sm` pill) so it
// reads as the tab bar becoming the action bar — the tab bar itself slides away
// underneath, see lib/tabBarStore.ts.
//
// One action, so it is a labelled button rather than a row of glyph tabs. A
// single unlabelled trash icon floating at the bottom of a screen is how people
// delete things they meant to tap past.

export function DocumentSelectionBar({
  count,
  busy = false,
  onDelete,
}: {
  count: number
  busy?: boolean
  /** Receives the button's rect so the confirm sheet morphs out of it. */
  onDelete: (rect: DOMRect) => void
}) {
  const disabled = busy || count === 0

  return (
    <motion.div
      initial={{ y: 96, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 96, opacity: 0 }}
        onClick={(e) => onDelete(e.currentTarget.getBoundingClientRect())}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      className="bottom-safe fixed inset-x-0 z-40 mx-auto flex w-fit max-w-sm items-center justify-center rounded-pill bg-surface/95 px-2 py-2 shadow-elevated backdrop-blur-xl transition-colors hover:bg-danger-soft"
    >
      <button
        type="button"
        disabled={disabled}
        className="flex items-center gap-2 rounded-pill text-body-sm font-medium text-danger transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Trash2 size={18} />
        {count === 0 ? 'Delete' : count === 1 ? 'Delete 1 document' : `Delete ${count} documents`}
      </button>
    </motion.div>
  )
}
