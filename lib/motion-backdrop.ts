import type { Variants } from 'framer-motion'

/**
 * Blurred-scrim choreography — deliberately DECOUPLED from the shell spring in
 * lib/motion.ts.
 *
 * Frame-by-frame measurement of the real iOS app-launch animation shows that
 * backdrop blur and window geometry do not share a timeline:
 *
 *   window geometry (transform/scale) ~280ms, critically damped spring
 *   backdrop blur                     ~92% of full strength by ~68ms
 *
 * Measured wallpaper sharpness behind an opening window: 100% → 25.1% at
 * t=33ms → 7.6% at t=68ms. In other words the frost is essentially a step
 * function at the very start — roughly 4× faster than the geometry — and is
 * already fully there before the panel has finished moving.
 *
 * The classic mistake in a hand-built imitation is fading the scrim on the same
 * curve as the shell, so the surface appears to *gain frost gradually* as it
 * grows. That single coupling is the main reason an imitation reads as heavy.
 * The scrim fade this replaced ran 0.28s on enter — exactly that mistake: the
 * frost finished landing ~80ms AFTER the shell spring had already settled. It
 * was removed from lib/motion.ts rather than deprecated, so the slow curve
 * cannot be reintroduced by importing the wrong symbol.
 *
 * Enter is therefore ~70ms on a plain ease-out (the CSS twins are
 * `--duration-ios-blur` / `--ease-ios-open`). Exit is intentionally left at the
 * slower 0.18s: on dismiss iOS lets the blur linger slightly behind the
 * geometry, and snapping the frost off is the more obviously wrong direction.
 *
 * NOTE — the old MORPH_BACKDROP_FADE has been DELETED from lib/motion.ts rather
 * than deprecated. It differed from this one only on enter (0.28s vs 0.07s) and
 * agreed on exit, so importing the wrong one would have silently restored the
 * late frost with no type error and no visual clue at the call site. Removing it
 * makes that mistake impossible instead of merely discouraged. Every blurred
 * scrim in the app uses BACKDROP_BLUR_FADE; use it for any new one.
 *
 * Opacity-only, by design. `backdrop-filter` on an element that is itself being
 * transformed forces the WebView to re-rasterise the sampled region every
 * frame; every consumer of this keeps the blur on a static full-bleed layer and
 * puts the transform on a sibling.
 */
export const BACKDROP_BLUR_FADE: Variants = {
  initial: { opacity: 0 },
  // 0.07s ≈ the measured 68ms to ~92% frost. Not a spring: the real thing has
  // no overshoot to imitate here, it is a hard, early step.
  animate: { opacity: 1, transition: { duration: 0.07, ease: [0, 0, 0.2, 1] } },
  exit: { opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } },
}

/**
 * Compositing hint for a full-bleed blurred scrim: promotes the layer so WebKit
 * rasterises the blur ONCE and then animates opacity on the cached bitmap.
 * Without it a fullscreen `backdrop-filter` is re-sampled on every frame that
 * anything above it moves — the most expensive thing on a morphing screen.
 * Blur radius and colour are unaffected; this is purely a compositing hint.
 */
export const BACKDROP_BLUR_STYLE = { willChange: 'opacity' } as const
