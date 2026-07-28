import { useCallback, useRef } from 'react'

/**
 * Focus an element once, without scrolling to it.
 *
 * Plain `autoFocus` focuses AND scrolls the element into view. Inside a sheet
 * that means the sheet's own scroll body jumps down to the input, pushing the
 * field's label — and sometimes the title — out of sight before the user has
 * looked at anything. The sheet opens already scrolled, which reads as broken.
 *
 * `focus({ preventScroll: true })` keeps the keyboard-opens-ready behaviour
 * that makes a one-field sheet quick, without the jump.
 *
 * Returns a ref callback. Focuses on the first mount where `active` is true and
 * re-arms once `active` goes false, so a reopened sheet focuses again.
 */
export function useAutoFocus<T extends HTMLElement>(active: boolean): (node: T | null) => void {
  const focused = useRef(false)
  if (!active) focused.current = false

  return useCallback(
    (node: T | null) => {
      if (!node || !active || focused.current) return
      focused.current = true
      node.focus({ preventScroll: true })
    },
    [active],
  )
}
