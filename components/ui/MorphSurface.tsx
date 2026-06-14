'use client'

import { forwardRef } from 'react'
import { AnimatePresence, motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'

import { cn } from '@/lib/cn'
import { MORPH_CONTENT_VARIANTS, MORPH_SHAPE_STYLE, MORPH_SPRING } from '@/lib/motion'

/**
 * MorphSurface — the Dynamic Island morph engine (Wiscord), reusable across
 * Mo's expanding surfaces (chatbot popup, voice record popup, dropdowns,
 * toasts). Physics are identical to Wiscord; the skin is Mo marble.
 *
 * How it works (mirrors Wiscord's DynamicIsland.tsx):
 *  - The shell animates `width`/`height` directly via `animate` (NOT `layout`,
 *    which scale-distorts children) using MORPH_SPRING.
 *  - Content is swapped with `<AnimatePresence mode="wait">`, keyed by `state`,
 *    so the outgoing content fully fades out before the empty shell morphs and
 *    the incoming content fades in over the morph (MORPH_CONTENT_VARIANTS).
 *  - `overflow-hidden` clips mid-morph; each state owns its padding.
 *  - `prefers-reduced-motion` → instant resize, instant content swap.
 *
 * The caller drives `state`, supplies a `shapes` map (one MorphShape per state),
 * and renders the content for the current state as `children` (the child is
 * keyed by `state` internally).
 */
export interface MorphShape {
  width: number
  height: number
  /**
   * Corner radius in px — animated as a number (NOT a Tailwind class) so it
   * interpolates with the shell spring. A class swaps instantly and pops mid-
   * morph (a tall box briefly gets pill-rounded before it shrinks). For a true
   * pill, set radius to height/2.
   */
  radius: number
  paddingX?: number
  paddingY?: number
  /**
   * Optional shell background, animated with the spring so a colored launcher
   * (e.g. a crimson FAB) morphs into a white panel without a flash. Must be a
   * CONCRETE color framer can interpolate (`rgb(…)`/hex), not a CSS var. When a
   * MorphSurface uses backgrounds, set it on every shape. When omitted, the
   * shell stays `bg-surface` (white).
   */
  background?: string
}

interface MorphSurfaceProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  state: string
  shapes: Record<string, MorphShape>
  children: React.ReactNode
}

export const MorphSurface = forwardRef<HTMLDivElement, MorphSurfaceProps>(function MorphSurface(
  { state, shapes, children, className, ...rest },
  ref,
) {
  const reduced = useReducedMotion()
  const shape = shapes[state]

  return (
    <motion.div
      ref={ref}
      initial={false}
      animate={{
        width: shape.width,
        height: shape.height,
        borderRadius: shape.radius,
        ...(shape.background ? { backgroundColor: shape.background } : {}),
      }}
      transition={reduced ? { duration: 0 } : MORPH_SPRING}
      style={MORPH_SHAPE_STYLE}
      className={cn(
        'overflow-hidden border border-border text-ink shadow-elevated',
        className,
      )}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        <MorphSlot key={state} shape={shape}>
          {children}
        </MorphSlot>
      </AnimatePresence>
    </motion.div>
  )
})

/**
 * Content slot — fills the shell and owns the per-shape padding so insets shrink
 * WITH the shell during a collapse instead of jumping at exit-complete. Carries
 * the fade variants so view content stays plain markup.
 */
function MorphSlot({ shape, children }: { shape: MorphShape; children: React.ReactNode }) {
  return (
    <motion.div
      variants={MORPH_CONTENT_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="h-full w-full"
      style={{ paddingInline: shape.paddingX ?? 0, paddingBlock: shape.paddingY ?? 0 }}
    >
      {children}
    </motion.div>
  )
}
