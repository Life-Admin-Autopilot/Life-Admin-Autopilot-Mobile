import type { Transition, Variants, MotionStyle } from 'framer-motion'

/**
 * Morph animation system — the shell, its contents, and the backdrop.
 *
 * Every spring in this file is now CRITICALLY DAMPED (ζ = 1.000): the fastest
 * approach to rest that never crosses the target. This is a deliberate revision
 * of an earlier note that said the physics were ported verbatim from Wiscord's
 * Dynamic Island and must not be retuned. A frame-by-frame capture of the real
 * SpringBoard app-open transition (iOS 26.5) measured that system at ζ = 1.000,
 * ωₙ = 22.34 rad/s — SwiftUI's `Spring(duration: 0.28, bounce: 0)`. Held against
 * that reference, all three springs here were OVERdamped: ζ = 1.021 (shell),
 * 1.042 (list), 1.132 (step).
 *
 * Overdamping is not a harmless safety margin. Past ζ = 1 the system splits into
 * two real exponentials and the tail of the motion decays on the slower of the
 * two, so an overdamped spring settles strictly later than a critical one of the
 * same ωₙ while still never overshooting. That long, flat final approach is the
 * mathematical signature of the "slightly mushy" feel — and it also means the
 * old header's claim of "~1 frame of overshoot" was unachievable, since no
 * spring at ζ > 1 overshoots at all.
 *
 * Only ζ moved, plus the shell's frequency:
 *
 *   MORPH  ωₙ 22.34 rad/s  re-anchored to the measured iOS constant; perceptual
 *                          duration 2π/ωₙ = 0.281 s. The previous ωₙ of
 *                          16.33 rad/s needed a 37% lift to reach it.
 *   LIST   ωₙ 23.30 rad/s  unchanged (stiffness 380, mass 0.7)
 *   STEP   ωₙ 29.44 rad/s  unchanged (stiffness 520, mass 0.6)
 *
 * LIST and STEP keep their own natural frequencies on purpose. The speed
 * hierarchy this file is built around — a step is quicker than a row, a row is
 * quicker than a shell — lives in ωₙ, not in ζ, and collapsing all three onto
 * the iOS shell constant would have flattened it. Everything was derived with
 * stiffness = ωₙ²·m and damping = 2·ζ·ωₙ·m at ζ = 1, mass held fixed throughout,
 * so the only felt change to the list and step families is a tighter finish.
 *
 * The single biggest fidelity cue is TIMING SEPARATION: when the shape changes,
 * the old content fades all the way out (pure opacity, ~60ms) BEFORE the shell
 * morph is visible, the shell morphs while empty, then the new content fades in
 * over the morph. Without it you get the "squish and zoom" frame where the old
 * card's contents visibly compress as the shell shrinks beneath them.
 *
 *   t=0          shape changes, exit fires on outgoing content
 *   t=0..60ms    exit fade — pure opacity (no y/scale/blur — those read cheap)
 *   t=60ms       AnimatePresence mode="wait" unblocks, new child mounts
 *   t=60ms       shell morph starts (delay matches exit duration)
 *   t=140ms      new content begins fading in (overlaps the morph)
 *   t=~340ms     shape settled, new content fully visible
 *
 * That sequence is unchanged and is not up for retuning — only the spring
 * physics moved. The shell still animates width/height directly (NOT framer's
 * `layout`, which uses transform:scale and distorts children).
 */

const SHELL_DELAY = 0.06
const EXIT_DURATION = 0.06

/**
 * The shell's raw physics, shared by the island/sheet morph and the page-enter
 * transition. Kept separate from MORPH_SPRING because the page transition must
 * NOT inherit SHELL_DELAY: that delay exists to clear the outgoing content of a
 * morphing shell, and a route enter has nothing to clear.
 */
const SHELL_PHYSICS = {
  type: 'spring',
  stiffness: 449.2,
  damping: 40.21,
  mass: 0.9,
} as const

export const MORPH_SPRING: Transition = {
  ...SHELL_PHYSICS,
  delay: SHELL_DELAY,
}

export const MORPH_SHAPE_STYLE: MotionStyle = {
  transformOrigin: 'top right',
  originX: 1,
  originY: 0,
}

export const MORPH_CONTENT_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: {
    opacity: 1,
    transition: { duration: 0.18, delay: 0.08, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    transition: { duration: EXIT_DURATION, ease: [0.4, 0, 1, 1] },
  },
}

/**
 * List choreography — insert, remove, and reorder on the matters list.
 *
 * Deliberately separate from the morph family: a row is not a shell. Rows use
 * framer's `layout="position"`, NOT plain `layout` — plain layout animates the
 * box, which scales a row's contents during the transition and produces exactly
 * the squish the morph shell avoids by animating width/height directly.
 * Position-only means a row that moves slides, and a row that changes height
 * doesn't smear.
 *
 * Exit never animates height either (see the "never animate layout properties"
 * rule): the leaving row fades and lifts, and its neighbours close the gap
 * through their own `layout` transition once it unmounts.
 *
 * Stiffness and mass are untouched, so a row keeps its own ωₙ of 23.30 rad/s and
 * stays a shade quicker than the shell. Damping alone came down from 34 to reach
 * ζ = 1.000 exactly (2·ωₙ·m), which sharpens the last few frames of a settle.
 */
export const LIST_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 32.62,
  mass: 0.7,
}

export const LIST_ITEM_VARIANTS: Variants = {
  initial: { opacity: 0, y: -8 },
  animate: { opacity: 1, y: 0, transition: LIST_SPRING },
  exit: {
    opacity: 0,
    y: 4,
    transition: { duration: 0.16, ease: [0.4, 0, 1, 1] },
  },
}

/**
 * Step rows inside the matter editor.
 *
 * Deliberately quicker and shorter-travelled than LIST_ITEM_VARIANTS: a step is
 * a line inside a sheet, not a card in a page-length list, and it is added and
 * ticked in a burst. A new step rises from the field that created it; a removed
 * one shrinks away in place.
 *
 * Pair with `AnimatePresence mode="popLayout"`: the leaving row drops out of the
 * flow on its first exit frame, so the rows under it close the gap through their
 * own `layout` transition instead of waiting out the fade.
 *
 * As with LIST_SPRING, stiffness and mass hold: a step keeps ωₙ = 29.44 rad/s,
 * the fastest of the three families, which is the whole point of it being its
 * own spring. Damping dropped from 40 to 2·ωₙ·m for ζ = 1.000 — this one was the
 * most overdamped of the set (ζ = 1.132) and gains the most from the change.
 */
export const STEP_SPRING: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 35.33,
  mass: 0.6,
}

export const STEP_ITEM_VARIANTS: Variants = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: STEP_SPRING },
  exit: {
    opacity: 0,
    scale: 0.96,
    transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
  },
}

/**
 * Page transitions — the outgoing route closes, then the incoming route opens.
 *
 * Enter reuses SHELL_PHYSICS, so a page opening and an island morphing are
 * literally the same physics: ζ = 1.000, ωₙ = 22.34 rad/s, perceptual duration
 * 2π/ωₙ = 0.281 s. This used to inline its own copy of the shell numbers, which
 * meant the page enter silently kept the old values whenever the shell was
 * retuned. It is spread rather than referenced so the two transitions stay
 * independent objects, and it deliberately drops SHELL_DELAY: that delay exists
 * to clear the outgoing content of a morphing shell, and a route enter has
 * nothing to clear.
 *
 * Exit is a TWEEN, not a spring, and that is the one genuinely non-obvious
 * decision in this file. `AnimatePresence mode="wait"` holds the incoming route
 * until the outgoing exit *completes*, so the exit's duration is not merely how
 * long the old page takes to leave — it is dead time sitting in front of every
 * single navigation. A spring has no true completion: it approaches rest
 * asymptotically and framer declares it finished when it crosses a
 * `restDelta`/`restSpeed` threshold, which makes its wall-clock end
 * threshold-dependent and free to overrun. A tween has a duration it is obliged
 * to honour, so the handoff lands on a known frame. The measured close on device
 * genuinely is spring-driven, but across 130 ms of a fade-and-shrink the
 * difference between the two curves is imperceptible, while the timing
 * indeterminacy very much is not — so we trade the curve for the certainty.
 *
 * The asymmetry (0.13 s out, ~0.28 s in) is not arbitrary either. The same
 * frame-by-frame SpringBoard capture that anchored ωₙ puts the close at roughly
 * twice the speed of the open, with the geometric shrink landing at 0.12–0.13 s.
 * Reproducing that ratio is most of why a real iOS navigation reads as
 * responsive rather than ceremonial.
 *
 * `ease: [0.4, 0, 1, 1]` is this file's established exit idiom — see
 * MORPH_CONTENT_VARIANTS, LIST_ITEM_VARIANTS and STEP_ITEM_VARIANTS, which all
 * use it. It is an accelerating curve, which is the right shape for something on
 * its way out.
 */
export const PAGE_VARIANTS: Variants = {
  // NO `y`. The measured transition is a pure affine SCALE about an anchor —
  // iOS's own Reduce Motion substitute is a plain cross-fade, which is only a
  // valid substitute for a scale, not for a translation. A vertical lift is a
  // web idiom; adding one is what makes an imitation read as "fade up" instead
  // of "open". Scale magnitude is deliberately visible: the real thing zooms an
  // icon to a full screen, and anything under ~5% is perceptually a fade.
  initial: { opacity: 0, scale: 0.92 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: {
      // Geometry on the measured spring: ζ = 1.000, ωₙ = 22.34 rad/s.
      ...SHELL_PHYSICS,
      opacity: { duration: 0.12, ease: [0, 0, 0.2, 1] },
    },
  },
  exit: {
    opacity: 0,
    scale: 0.96,
    transition: { duration: 0.13, ease: [0.4, 0, 1, 1] },
  },
}

/**
 * The blur half of the page transition, carried by a separate empty overlay
 * rather than by a `filter` on the page itself.
 *
 * That split is forced, and the reason is worth recording because the obvious
 * implementation is broken. Per CSS spec, any `filter` value other than `none`
 * makes an element a containing block for its `position: fixed` descendants.
 * Framer normalises a `none` target back to `blur(0px)` whenever the other
 * keyframe is a blur, and re-applies its own style on re-render, so an imperative
 * cleanup does not stick either — verified in the browser, the wrapper settled at
 * a computed `filter: blur(0px)` every time. Any route containing a non-portalled
 * fixed element (the full-bleed scrims in `components/ui/Sheet.tsx`) would then
 * anchor to the page wrapper instead of the viewport and mis-size.
 *
 * An empty overlay has no descendants, so its containing block harms nothing —
 * and `backdrop-filter` on a layer above the content is, in any case, what iOS
 * actually does: the system blurs a backdrop layer sampled from what is behind
 * it, it does not run a filter over the view's own contents.
 *
 * Timing is the measured decoupling and is the whole point of this overlay
 * existing. Wallpaper sharpness behind an opening window went 100% → 25.1% at
 * 33ms → 7.6% at 68ms, while the geometry took 280ms to settle. The frost is
 * effectively a step function at the very start, resolved long before the shape
 * finishes moving. Running it on the same curve as the scale is the single most
 * likely reason a hand-built copy reads as heavy.
 */
export const PAGE_BLUR_VARIANTS: Variants = {
  // The incoming page is NOT blurred, and that is the faithful reading. On iOS
  // the app being opened never blurs — the wallpaper BEHIND it does, and stays
  // blurred for as long as the app is up. An earlier cut of this had the new
  // page sharpen from blur(10px) over the measured 68ms, which is both inverted
  // (blurring the thing iOS keeps sharp) and, at 68ms in and straight back out,
  // an imperceptible flash. Blur belongs on the page being put away.
  initial: { backdropFilter: 'blur(0px)', opacity: 0 },
  animate: { backdropFilter: 'blur(0px)', opacity: 0, transition: { duration: 0 } },
  exit: {
    backdropFilter: 'blur(10px)',
    opacity: 1,
    transition: {
      // Ramp on the measured curve — 92% of full strength in ~68ms — and then
      // HOLD for the rest of the exit. That hold is the point: the measurement
      // shows a near-step function that settles and stays, not a pulse. A blur
      // that ramps and immediately releases reads as a flicker, or as nothing.
      backdropFilter: { duration: 0.07, ease: [0, 0, 0.2, 1] },
      opacity: { duration: 0.05, ease: 'linear' },
    },
  },
}
