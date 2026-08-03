// Converts a framer-motion spring into a CSS `linear()` easing function.
//
// WHY: framer integrates spring physics in JS on every animation frame, which
// means requestAnimationFrame — and WebKit caps rAF at 60Hz inside WKWebView by
// deliberate design (docs/CAPACITOR.md → "Animation frame rate"). A spring is
// not inherently a JS construct though; it is just a curve. Sample that curve
// densely enough and CSS can drive it natively: no per-frame JS, not rAF-bound.
//
// `linear()` interpolates linearly between a list of output values and permits
// values outside 0..1, so spring overshoot survives the translation. Supported
// from Safari 17.2 (Dec 2023).
//
// The physics below are the standard damped harmonic oscillator framer uses, so
// a converted transition traces the SAME path as the JS spring it replaces —
// this is a transport change, not a retune. Keep it that way.

/** Matches the spring fields of framer's `Transition`. */
export interface SpringSpec {
  stiffness: number
  damping: number
  mass: number
}

export interface LinearEasing {
  /** CSS easing, e.g. `linear(0, 0.42, 0.87, 1)`. */
  easing: string
  /** Milliseconds until the spring settles — the CSS animation duration. */
  durationMs: number
}

// Settling thresholds. Tighter than framer's defaults (restDelta 0.01) because
// a visible snap at the end is exactly the kind of "close enough" that reads as
// a different animation.
const REST_DELTA = 0.0005
const MAX_DURATION_MS = 5000
/**
 * Sample count. `linear()` interpolates linearly BETWEEN points, so segments
 * must stay under one frame or the straight-line joins facet visibly. At 120Hz
 * a frame is 8.3ms; 100 samples over MORPH_SPRING's ~650ms settle gives ~6.5ms
 * segments, comfortably sub-frame.
 */
const SAMPLES = 100

/**
 * Normalised spring displacement at time `t` (seconds), travelling 0 → 1 from
 * rest. Branches on the damping ratio because the closed-form solution differs;
 * using the underdamped form at zeta >= 1 divides by zero.
 */
function springValue(spec: SpringSpec, t: number): number {
  const { stiffness, damping, mass } = spec
  const omega0 = Math.sqrt(stiffness / mass)
  const zeta = damping / (2 * Math.sqrt(stiffness * mass))

  if (zeta < 1) {
    // Underdamped — oscillates, overshoots.
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta)
    const envelope = Math.exp(-zeta * omega0 * t)
    return 1 - envelope * (Math.cos(omegaD * t) + ((zeta * omega0) / omegaD) * Math.sin(omegaD * t))
  }

  if (zeta === 1) {
    // Critically damped — fastest approach with no overshoot.
    return 1 - Math.exp(-omega0 * t) * (1 + omega0 * t)
  }

  // Overdamped — two real roots, no overshoot. Kitto's morph springs all land
  // marginally here (MORPH_SPRING: zeta ~1.02).
  const alpha = omega0 * Math.sqrt(zeta * zeta - 1)
  const r1 = -zeta * omega0 + alpha
  const r2 = -zeta * omega0 - alpha
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1)
}

/**
 * Seconds until the spring is within REST_DELTA of 1.
 *
 * This truncates a curve that technically never terminates, and the truncation
 * point does NOT need to match framer's internal rest thresholds. What matters
 * for visual fidelity is absolute-time fidelity: the sampled curve maps
 * [0, settle] → [0, 1], CSS plays it over exactly `settle`, so at any absolute
 * t the displayed value equals the spring's. Framer running a longer invisible
 * tail (sub-0.05% movement) is imperceptible either way.
 */
function settleTime(spec: SpringSpec): number {
  const step = 1 / 1000
  for (let t = 0; t < MAX_DURATION_MS / 1000; t += step) {
    if (Math.abs(1 - springValue(spec, t)) < REST_DELTA) return t
  }
  return MAX_DURATION_MS / 1000
}

/**
 * Samples `spec` into a CSS `linear()` easing plus the duration it settles in.
 *
 * Values are evenly spaced in time, so `linear()` needs no explicit stop
 * percentages — the browser distributes them.
 */
export function springToLinearEasing(spec: SpringSpec): LinearEasing {
  const durationSec = settleTime(spec)
  const points: string[] = []

  for (let i = 0; i <= SAMPLES; i++) {
    const t = (i / SAMPLES) * durationSec
    // Pin the endpoint exactly: sampling can land a hair off 1, and a shell
    // that stops 0.3px shy of its target is a visible seam.
    const value = i === SAMPLES ? 1 : springValue(spec, t)
    points.push(value.toFixed(5).replace(/\.?0+$/, ''))
  }

  return {
    easing: `linear(${points.join(', ')})`,
    durationMs: Math.round(durationSec * 1000),
  }
}
