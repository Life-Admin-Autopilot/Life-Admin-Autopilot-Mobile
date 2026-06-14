'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { MORPH_SPRING } from '@/lib/motion'

// Mirrors --color-surface (white island) / --color-canvas (marble) — tokens.md.
const SURFACE = 'rgb(255 255 255)'
const CANVAS = 'rgb(243 240 234)'

// The onboarding → home handoff: the island EXTENDS to fill the screen. It
// starts from the live island rect (captured by OnboardingIsland) — same size,
// position, white surface, 26px radius — and grows to fullscreen marble with the
// island spring, so it reads as the Dynamic Island itself expanding rather than
// a new pill popping in. The home greeting fades in over the morph. `onComplete`
// fires when the morph settles (the page then commits the session + routes to
// /dashboard). Reduced-motion → instant.
export function IslandHandoff({
  name,
  fromRect,
  onComplete,
}: {
  name: string
  fromRect: DOMRect | null
  onComplete: () => void
}) {
  const reduced = useReducedMotion()
  const [vp] = useState(() => ({
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  }))

  // Fall back to a centered done-shape (348×208) if the rect wasn't captured.
  const start = fromRect ?? {
    top: vp.h / 2 - 104,
    left: vp.w / 2 - 174,
    width: 348,
    height: 208,
  }

  return (
    <motion.div
      className="fixed z-50 overflow-hidden"
      initial={{
        top: start.top,
        left: start.left,
        width: start.width,
        height: start.height,
        borderRadius: 26,
        backgroundColor: SURFACE,
      }}
      animate={{
        top: 0,
        left: 0,
        width: vp.w,
        height: vp.h,
        borderRadius: 0,
        backgroundColor: CANVAS,
      }}
      transition={reduced ? { duration: 0 } : MORPH_SPRING}
      onAnimationComplete={onComplete}
    >
      <div className="grid h-full w-full place-items-center">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: reduced ? 0 : 0.28, duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          <h1 className="font-display text-display-hero text-ink">Good to see you, {name}.</h1>
          <p className="mt-1 text-body text-ink-muted">Order, restored.</p>
        </motion.div>
      </div>
    </motion.div>
  )
}
