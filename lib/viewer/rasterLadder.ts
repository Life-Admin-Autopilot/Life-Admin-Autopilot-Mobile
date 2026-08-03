// How sharply a PDF page is rasterized for a given zoom.
//
// Re-rendering on every settled scale would rasterize a full page for a 3%
// pinch adjustment, so zoom is quantised onto a ladder instead: the page is
// drawn at the next rung ABOVE the current zoom and the CSS transform scales it
// down, which is the direction that stays sharp. Downscaling a bitmap looks
// fine; upscaling one is the blur this viewer exists to remove.

/** Rungs as multiples of fit-to-page. */
const RUNGS = [1, 1.5, 2, 3, 4.5, 6]

/**
 * Hard ceiling on the backing store. iOS evicts canvases well before the
 * nominal 16MP limit, and an evicted canvas comes back blank — a white page
 * where the document was. Staying under budget is a correctness constraint,
 * not a performance tweak.
 */
const MAX_CANVAS_PIXELS = 8_000_000
const MAX_CANVAS_EDGE = 4096

/** The rung to rasterize at, in content-px per CSS-px, for a settled zoom. */
export function rasterStepFor(settledScale: number, fitScale: number): number {
  if (fitScale <= 0) return 1
  const ratio = settledScale / fitScale
  const rung = RUNGS.find((r) => r >= ratio - 0.001) ?? RUNGS[RUNGS.length - 1]
  return fitScale * rung
}

/**
 * Trims a target scale until the canvas it implies fits the memory budget.
 * Returns device-pixel scale, DPR already folded in.
 */
export function budgetedRasterScale(target: number, dpr: number, page: { width: number; height: number }): number {
  if (page.width <= 0 || page.height <= 0) return target
  const wanted = target * dpr
  const byArea = Math.sqrt(MAX_CANVAS_PIXELS / (page.width * page.height))
  const byEdge = Math.min(MAX_CANVAS_EDGE / page.width, MAX_CANVAS_EDGE / page.height)
  return Math.max(0.05, Math.min(wanted, byArea, byEdge))
}
