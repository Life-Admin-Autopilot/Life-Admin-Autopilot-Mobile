'use client'

import { useCallback, useEffect, useRef } from 'react'

// Press-and-hold to enter selection mode.
//
// Extracted from DocumentRow, which had the only copy. Matters needs the same
// gesture and the logic is all edge cases — cancel on scroll, cancel on
// unmount, swallow the click that follows the release — so a second
// hand-rolled copy would drift from this one within a release.

const LONG_PRESS_MS = 450
// A press that wanders this far was a scroll, not a hold. Without it, dragging
// the list with a finger resting on a row arms selection mid-scroll.
const LONG_PRESS_SLOP_PX = 10

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
  onContextMenu: (e: React.MouseEvent) => void
}

export interface LongPress {
  handlers: LongPressHandlers
  /**
   * Call FIRST inside any click handler on the pressed element. Returns true
   * when the hold already fired, meaning this click is the finger lifting and
   * must not also open/complete the row behind the selection UI that just
   * appeared. Consumes the flag.
   */
  consumeClick: () => boolean
}

export function useLongPress(
  onLongPress?: () => void,
  /** Typically `selectable` — no point arming the gesture once already in it. */
  disabled = false,
): LongPress {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  // A row can unmount mid-hold (the list refetches on a poll), and a timer left
  // running would fire onLongPress for a row that is no longer on screen.
  useEffect(() => cancel, [cancel])

  const armed = Boolean(onLongPress) && !disabled

  const onPointerDown = (e: React.PointerEvent): void => {
    if (!armed) return
    origin.current = { x: e.clientX, y: e.clientY }
    fired.current = false
    timer.current = setTimeout(() => {
      fired.current = true
      cancel()
      onLongPress?.()
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const start = origin.current
    if (!start) return
    if (
      Math.abs(e.clientX - start.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(e.clientY - start.y) > LONG_PRESS_SLOP_PX
    ) {
      cancel()
    }
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // Desktop affordance for the same gesture — a right-click on a list row
      // reaching for "select" should not drop the browser menu on top of it.
      onContextMenu: (e) => {
        if (!armed) return
        e.preventDefault()
        onLongPress?.()
      },
    },
    consumeClick: () => {
      if (!fired.current) return false
      fired.current = false
      return true
    },
  }
}
