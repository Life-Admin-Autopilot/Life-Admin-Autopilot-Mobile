import { useState } from 'react'

/**
 * Run `reset` on the render where `open` flips false → true.
 *
 * Every sheet in this app owns its own draft and has to clear it each time it
 * opens, or an abandoned edit reappears the next time. The obvious way to write
 * that is `useEffect(() => { if (open) reset() }, [open])` — but an effect that
 * only calls setState is a cascading render: React commits the stale draft,
 * paints it, then immediately re-renders with the reset one, and on a slow
 * device you can see the old value flash.
 *
 * Adjusting state during render is React's documented answer for "reset state
 * when a prop changes". React discards the in-progress render and restarts
 * before anything reaches the DOM, so the stale value is never painted. It is
 * the same idiom BulkDeleteConfirm already uses to hold its preview through a
 * collapse — this just names it, since four sheets need it.
 */
export function useResetOnOpen(open: boolean, reset: () => void): void {
  const [wasOpen, setWasOpen] = useState(open)

  if (open !== wasOpen) {
    setWasOpen(open)
    // Only on the way in. Resetting on close would wipe the draft mid-collapse,
    // and the sheet is still on screen for the length of that animation.
    if (open) reset()
  }
}
