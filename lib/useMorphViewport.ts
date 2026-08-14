'use client'

// Measuring the box a `position: fixed` element is actually positioned against.
//
// It is NOT always the window. PhoneFrame's shell carries `transform-gpu`, and
// per spec a transformed ancestor becomes the containing block for its fixed
// descendants — so on desktop the "viewport" is the 410x864 phone, while
// `window.innerWidth/innerHeight` still report the browser. Geometry computed
// from the window therefore lands outside the frame, which also has
// `overflow-hidden`, and the element is clipped away entirely: present in the
// DOM, invisible on screen, and impossible to tell apart from "it never opened".
//
// That is exactly what happened to the document capture sheet: `left` came out
// around 548px inside a 410px-wide frame, so tapping "Add a document" appeared
// to do nothing at all.
//
// MorphSheet solved this first, with the probe below. This is that solution
// lifted out so the next morphing surface cannot get it wrong again.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface MorphViewport {
  width: number
  height: number
  /** Offset of the containing block within the window, for converting triggers. */
  top: number
  left: number
}

export interface MorphViewportHandle {
  /** Null until a real measurement lands. Callers must not position without it. */
  vp: MorphViewport | null
  /** Attach to an always-mounted `fixed inset-0` probe element. */
  measure: (node: HTMLDivElement | null) => void
  /** Re-measure on demand — call when a surface is about to open. */
  remeasure: () => void
}

export function useMorphViewport(): MorphViewportHandle {
  const [vp, setVp] = useState<MorphViewport | null>(null)
  const probeRef = useRef<HTMLDivElement | null>(null)

  const read = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const r = node.getBoundingClientRect()
    // A zero box means the containing block is not laid out YET, not that it is
    // genuinely empty. Storing it would compute a negative width below and
    // render an invisible surface; staying null keeps callers from positioning
    // against a lie.
    if (r.width === 0 || r.height === 0) return
    setVp({ width: r.width, height: r.height, top: r.top, left: r.left })
  }, [])

  const measure = useCallback(
    (node: HTMLDivElement | null) => {
      probeRef.current = node
      read(node)
    },
    [read],
  )

  // A window `resize` is not the only thing that moves this box: fonts arriving,
  // PhoneFrame sizing itself, an orientation change, or the containing block
  // being established late all change it without a resize event. Observing the
  // probe covers every one of them, the plain resize included.
  useEffect(() => {
    const node = probeRef.current
    if (!node) return
    const observer = new ResizeObserver(() => read(node))
    observer.observe(node)
    return () => observer.disconnect()
  }, [read])

  const remeasure = useCallback(() => read(probeRef.current), [read])

  return { vp, measure, remeasure }
}

/**
 * Convert a trigger rect from window coordinates into the containing block's.
 *
 * `getBoundingClientRect()` is always window-relative, but a fixed element
 * inside a transformed ancestor is not — so a morph that starts from a raw
 * trigger rect begins in the wrong place by exactly the frame's offset.
 */
export function toViewportSpace(
  rect: { top: number; left: number; width: number; height: number },
  vp: MorphViewport,
): { top: number; left: number; width: number; height: number } {
  return {
    top: rect.top - vp.top,
    left: rect.left - vp.left,
    width: rect.width,
    height: rect.height,
  }
}
