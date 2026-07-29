import type { Transition, Variants, MotionStyle } from 'framer-motion'

/**
 * Morph animation system — ported VERBATIM from Wiscord's Dynamic Island
 * (Wiscord/frontend/src/components/island/animations.ts). The physics are
 * intentionally IDENTICAL to Wiscord — do NOT retune.
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
 *   t=~360ms     shape settled, new content fully visible
 *
 * Shell spring calibrated to Mobbin samples (Forest, Opal, Apple Fitness):
 * ~1 frame of overshoot, hard settle. The shell animates width/height directly
 * (NOT framer's `layout`, which uses transform:scale and distorts children).
 */

const SHELL_DELAY = 0.06
const EXIT_DURATION = 0.06

export const MORPH_SPRING: Transition = {
  type: 'spring',
  stiffness: 240,
  damping: 30,
  mass: 0.9,
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

export const MORPH_BACKDROP_FADE: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.28, ease: 'easeOut' } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } },
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
 */
export const LIST_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 34,
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
 */
export const STEP_SPRING: Transition = {
  type: 'spring',
  stiffness: 520,
  damping: 40,
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
 * Page-transition enter — the route content "expands in" with the same spring
 * family (fade + a whisper of scale/lift, no delay). App Router does enter
 * transitions cleanly via `app/template.tsx`; exit needs a frozen-router lift
 * and is intentionally left off for now.
 */
export const MORPH_PAGE_VARIANTS: Variants = {
  initial: { opacity: 0, scale: 0.99, y: 8 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 240, damping: 30, mass: 0.9 },
  },
}
