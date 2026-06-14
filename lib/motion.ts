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
