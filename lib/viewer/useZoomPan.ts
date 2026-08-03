'use client'

// Pinch / pan / double-tap for the document viewer.
//
// The live gesture NEVER goes through React. Every move writes `transform`
// straight to the content node inside one rAF, and only the RESTING scale is
// published as state — once, when the fingers leave. A pinch is ~120 pointer
// events a second on a ProMotion panel; routing those through a render would
// re-run the page list and hand the compositor a new tree mid-gesture.
//
// Both DOM nodes are held in refs, not state, precisely because this hook
// mutates them. `attached` exists only to re-run the effects that must bind to
// a node once one arrives.
//
// Composited properties only, per the app's motion rules: transform, nothing
// else. The transition is attached solely for the double-tap animation and
// removed the moment it lands, so it can never interfere with a drag.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  clampScale,
  clampTransform,
  distanceBetween,
  DOUBLE_TAP_RATIO,
  fitScaleFor,
  midpointOf,
  zoomAround,
  ZOOMED_EPSILON,
  type Point,
  type Size,
  type Transform,
} from '@/lib/viewer/zoomPanMath'

const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_SLOP_PX = 24
const DOUBLE_TAP_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DOUBLE_TAP_DURATION_MS = 240

export interface UseZoomPanOptions {
  /** Natural CSS size of the content. Null until it is known (image/PDF metrics). */
  content: Size | null
  reducedMotion?: boolean
}

export interface UseZoomPanResult {
  containerRef: (node: HTMLDivElement | null) => void
  contentRef: (node: HTMLDivElement | null) => void
  /** Scale at rest. Rasterization keys off this, never the in-flight value. */
  settledScale: number
  fitScale: number
  isZoomed: boolean
  resetToFit: () => void
}

/** Identity of the current layout. Any change to it means the view starts over. */
function geometryKeyOf(content: Size | null, container: Size): string {
  if (!content || container.width <= 0) return ''
  return `${content.width}x${content.height}/${container.width}x${container.height}`
}

export function useZoomPan({ content, reducedMotion = false }: UseZoomPanOptions): UseZoomPanResult {
  const containerNode = useRef<HTMLDivElement | null>(null)
  const contentNode = useRef<HTMLDivElement | null>(null)
  const [attached, setAttached] = useState(false)
  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })

  // The user's zoom, tagged with the layout it was made in. When the geometry
  // changes — new document, rotation — the tag stops matching and the view
  // falls back to fit on its own. No effect has to reset anything.
  const [zoom, setZoom] = useState<{ key: string; scale: number } | null>(null)

  const transform = useRef<Transform>({ scale: 1, x: 0, y: 0 })
  const frame = useRef<number | null>(null)

  const fitScale = content ? fitScaleFor(content, containerSize) : 1
  const geometryKey = geometryKeyOf(content, containerSize)
  const settledScale = zoom?.key === geometryKey ? zoom.scale : fitScale
  const isZoomed = settledScale > fitScale * ZOOMED_EPSILON

  // Read inside pointer handlers, which are bound once per node. Reading React
  // state there would capture whatever it was at bind time.
  const geometry = useRef({ content, containerSize, fitScale, geometryKey })
  useEffect(() => {
    geometry.current = { content, containerSize, fitScale, geometryKey }
  }, [content, containerSize, fitScale, geometryKey])

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNode.current = node
    setAttached(Boolean(node))
  }, [])

  const contentRef = useCallback((node: HTMLDivElement | null) => {
    contentNode.current = node
  }, [])

  const paint = useCallback(() => {
    frame.current = null
    const node = contentNode.current
    if (!node) return
    const { scale, x, y } = transform.current
    // translate3d, not translate: keeps the layer on the compositor between
    // gestures instead of being promoted and demoted on every touch.
    node.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
    // Revealed here rather than through React state, so it happens in the same
    // write as the transform that places it. The layer ships hidden via a
    // class; this inline value outranks it. No extra render, and no frame where
    // the content is visible but still unpositioned at natural size.
    node.style.visibility = 'visible'
  }, [])

  const schedulePaint = useCallback(() => {
    frame.current ??= requestAnimationFrame(paint)
  }, [paint])

  const commit = useCallback(
    (next: Transform) => {
      const { content: c, containerSize: cs } = geometry.current
      if (!c) return
      transform.current = clampTransform(next, c, cs)
      schedulePaint()
    },
    [schedulePaint],
  )

  /** Publishes the resting scale so the pages can re-rasterize sharply. */
  const settle = useCallback(() => {
    setZoom({ key: geometry.current.geometryKey, scale: transform.current.scale })
  }, [])

  const animateTo = useCallback(
    (next: Transform) => {
      const node = contentNode.current
      if (!node) return
      if (reducedMotion) {
        commit(next)
        settle()
        return
      }
      node.style.transition = `transform ${DOUBLE_TAP_DURATION_MS}ms ${DOUBLE_TAP_EASE}`
      const done = () => {
        node.style.transition = ''
        node.removeEventListener('transitionend', done)
        settle()
      }
      node.addEventListener('transitionend', done)
      commit(next)
    },
    [commit, reducedMotion, settle],
  )

  const resetToFit = useCallback(() => {
    const { content: c, containerSize: cs, fitScale: fit } = geometry.current
    if (!c) return
    animateTo(clampTransform({ scale: fit, x: 0, y: 0 }, c, cs))
  }, [animateTo])

  // Track the container's box. A ResizeObserver rather than a window listener:
  // the panel is inset from the safe areas, so a rotation changes its box by a
  // different amount than it changes the window's, and the on-screen keyboard
  // resizes it with no window event at all. The observer delivers the initial
  // size on observe(), so there is no separate measuring pass.
  useEffect(() => {
    const node = containerNode.current
    if (!attached || !node) return
    const ro = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect()
      setContainerSize({ width: rect.width, height: rect.height })
    })
    ro.observe(node)
    return () => ro.disconnect()
  }, [attached])

  // Place the content whenever the geometry underneath it changes. `zoom` is
  // deliberately absent from the deps: a settled gesture must not re-run this
  // and snap the user back to fit.
  useEffect(() => {
    const node = contentNode.current
    if (!content || !containerSize.width) {
      // Falls back to the layer's hidden class until there is a real fit to
      // show. Nothing to paint yet, and nothing worth painting.
      if (node) node.style.visibility = ''
      return
    }
    transform.current = clampTransform({ scale: fitScale, x: 0, y: 0 }, content, containerSize)
    // Painted synchronously, not scheduled: a rAF here would let one frame
    // through with the layer revealed but not yet positioned.
    paint()
  }, [content, containerSize, fitScale, paint])

  useEffect(() => {
    const container = containerNode.current
    if (!attached || !container) return

    const pointers = new Map<number, Point>()
    let pinch: { distance: number; focus: Point; scale: number } | null = null
    let panFrom: Point | null = null
    let lastTap = { at: 0, x: 0, y: 0 }
    let moved = false

    const local = (e: PointerEvent): Point => {
      const rect = container.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const beginPinch = () => {
      const [a, b] = [...pointers.values()]
      pinch = {
        distance: distanceBetween(a, b),
        focus: midpointOf(a, b),
        scale: transform.current.scale,
      }
      panFrom = null
    }

    const onPointerDown = (e: PointerEvent) => {
      // Cancel an in-flight double-tap animation, otherwise the transition
      // keeps easing toward a target the user has started dragging away from.
      const node = contentNode.current
      if (node?.style.transition) node.style.transition = ''

      container.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, local(e))
      moved = false

      if (pointers.size === 2) beginPinch()
      else if (pointers.size === 1) panFrom = local(e)
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const point = local(e)
      pointers.set(e.pointerId, point)

      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const spread = distanceBetween(a, b)
        if (spread <= 0 || pinch.distance <= 0) return
        moved = true
        const next = clampScale((pinch.scale * spread) / pinch.distance, geometry.current.fitScale)
        // Anchor on the CURRENT midpoint, so sliding both fingers pans and
        // spreading them zooms — the two read as one continuous gesture.
        commit(zoomAround(transform.current, next, midpointOf(a, b)))
        return
      }

      if (panFrom && pointers.size === 1) {
        const dx = point.x - panFrom.x
        const dy = point.y - panFrom.y
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true
        panFrom = point
        const { scale, x, y } = transform.current
        commit({ scale, x: x + dx, y: y + dy })
      }
    }

    const endPointer = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return
      if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId)

      if (pointers.size === 1) {
        // Second finger lifted mid-pinch: hand off to a pan from wherever the
        // remaining finger is, or the view jumps by the gap between them.
        pinch = null
        panFrom = [...pointers.values()][0]
        return
      }
      if (pointers.size > 1) {
        beginPinch()
        return
      }

      pinch = null
      panFrom = null
      settle()

      if (moved) return
      const point = local(e)
      const now = e.timeStamp
      const isDoubleTap =
        now - lastTap.at < DOUBLE_TAP_MS &&
        Math.hypot(point.x - lastTap.x, point.y - lastTap.y) < DOUBLE_TAP_SLOP_PX

      if (isDoubleTap) {
        lastTap = { at: 0, x: 0, y: 0 }
        const { content: c, containerSize: cs, fitScale: fit } = geometry.current
        if (!c) return
        const zoomedIn = transform.current.scale > fit * ZOOMED_EPSILON
        const target = zoomedIn
          ? { scale: fit, x: 0, y: 0 }
          : zoomAround(transform.current, clampScale(fit * DOUBLE_TAP_RATIO, fit), point)
        animateTo(clampTransform(target, c, cs))
        return
      }
      lastTap = { at: now, x: point.x, y: point.y }
    }

    // Trackpad and mouse. ctrl+wheel is what a trackpad pinch arrives as.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { content: c, fitScale: fit } = geometry.current
      if (!c) return
      const rect = container.getBoundingClientRect()
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top }

      if (e.ctrlKey) {
        const next = clampScale(transform.current.scale * Math.exp(-e.deltaY / 100), fit)
        commit(zoomAround(transform.current, next, point))
      } else {
        const { scale, x, y } = transform.current
        commit({ scale, x: x - e.deltaX, y: y - e.deltaY })
      }
      settle()
    }

    // WebKit still drives page zoom off its own proprietary gesture events, and
    // touch-action does not suppress them. Without this a pinch zooms the whole
    // app chrome out behind the panel.
    const swallow = (event: Event) => event.preventDefault()

    container.addEventListener('pointerdown', onPointerDown)
    container.addEventListener('pointermove', onPointerMove)
    container.addEventListener('pointerup', endPointer)
    container.addEventListener('pointercancel', endPointer)
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('gesturestart', swallow, { passive: false })
    container.addEventListener('gesturechange', swallow, { passive: false })
    container.addEventListener('gestureend', swallow, { passive: false })

    return () => {
      container.removeEventListener('pointerdown', onPointerDown)
      container.removeEventListener('pointermove', onPointerMove)
      container.removeEventListener('pointerup', endPointer)
      container.removeEventListener('pointercancel', endPointer)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('gesturestart', swallow)
      container.removeEventListener('gesturechange', swallow)
      container.removeEventListener('gestureend', swallow)
    }
  }, [attached, animateTo, commit, settle])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return { containerRef, contentRef, settledScale, fitScale, isZoomed, resetToFit }
}
