// Pure transform math for the document viewer. No DOM, no React — the whole
// gesture state machine reduces to these four functions, so the fiddly part
// (anchoring a pinch, keeping content on screen) is testable on its own.
//
// Model: the content is laid out at its NATURAL size and moved by a single
// `translate(x, y) scale(s)` with `transform-origin: 0 0`. Origin at the corner
// is what makes anchoring tractable — with a centred origin every calculation
// has to carry a half-size correction term.

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export interface Transform {
  scale: number
  x: number
  y: number
}

/** Ceiling for pinch, as a multiple of fit. Past ~6x a scan is grain, not text. */
export const MAX_ZOOM_RATIO = 6

/** Where double-tap lands, as a multiple of fit — roughly reading width. */
export const DOUBLE_TAP_RATIO = 2.5

/** Below this much above fit the view counts as "not zoomed" for reset/UI. */
export const ZOOMED_EPSILON = 1.01

/**
 * The scale at which the whole content is visible. Deliberately fit-PAGE and
 * not fit-width: a document that opens already cropped is the bug this viewer
 * exists to fix.
 */
export function fitScaleFor(content: Size, container: Size): number {
  if (content.width <= 0 || content.height <= 0) return 1
  if (container.width <= 0 || container.height <= 0) return 1
  return Math.min(container.width / content.width, container.height / content.height)
}

export function clampScale(scale: number, fit: number): number {
  return Math.min(Math.max(scale, fit), fit * MAX_ZOOM_RATIO)
}

/**
 * Keeps the content honest against the viewport: centred on any axis where it
 * is smaller, and pinned to its own edges on any axis where it is larger. The
 * content can never be dragged into empty space.
 */
export function clampTransform(t: Transform, content: Size, container: Size): Transform {
  return {
    scale: t.scale,
    x: clampAxis(t.x, content.width * t.scale, container.width),
    y: clampAxis(t.y, content.height * t.scale, container.height),
  }
}

function clampAxis(offset: number, scaled: number, available: number): number {
  if (scaled <= available) return (available - scaled) / 2
  return Math.min(0, Math.max(available - scaled, offset))
}

/**
 * Rescale so the content point currently under `focus` is still under `focus`
 * afterwards. This is what makes a pinch track the fingers instead of drifting
 * toward a corner, and it is the same operation a double-tap needs.
 *
 * `focus` is in container coordinates.
 */
export function zoomAround(t: Transform, nextScale: number, focus: Point): Transform {
  const contentX = (focus.x - t.x) / t.scale
  const contentY = (focus.y - t.y) / t.scale
  return {
    scale: nextScale,
    x: focus.x - contentX * nextScale,
    y: focus.y - contentY * nextScale,
  }
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function midpointOf(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
