'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslations } from 'next-intl'

import { MORPH_SPRING } from '@/lib/motion'
import { useMorphColors } from '@/lib/motion-colors'

// The onboarding → home handoff: the island EXTENDS to fill the screen. It
// starts from the live island rect (captured by OnboardingIsland) — same size,
// position, white surface, 26px radius — and grows to fullscreen lavender with the
// island spring, so it reads as the Dynamic Island itself expanding rather than
// a new pill popping in. The home greeting fades in over the morph. `onComplete`
// fires when the morph settles (the page then commits the session + routes to
// /dashboard). Reduced-motion → instant.
export function IslandHandoff({
  name,
  fromRect,
  onComplete,
}: {
  /** First name, or null when the field was left blank. */
  name: string | null
  fromRect: DOMRect | null
  onComplete: () => void
}) {
  const t = useTranslations('onboarding')
  const reduced = useReducedMotion()
  const { surface, canvas } = useMorphColors()
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
        backgroundColor: surface,
      }}
      animate={{
        top: 0,
        left: 0,
        width: vp.w,
        height: vp.h,
        borderRadius: 0,
        backgroundColor: canvas,
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
          {/* Two whole messages rather than one with an interpolated "there":
              the English filler has no Arabic equivalent, and a greeting is
              exactly where a translated placeholder reads as a mistake. */}
          <h1 className="font-display text-display-hero text-ink">
            {name ? t('handoff.withName', { name }) : t('handoff.withoutName')}
          </h1>
          <p className="mt-1 text-body text-ink-muted">{t('handoff.subtitle')}</p>
        </motion.div>
      </div>
    </motion.div>
  )
}
