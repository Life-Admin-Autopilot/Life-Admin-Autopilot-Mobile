'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/cn'
import { MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'

/**
 * MorphPanel — the Dynamic Island morph for TRANSIENT overlays that mount and
 * unmount (dropdowns, toasts, transient popups). Same physics as MorphSurface
 * (MORPH_SPRING + content fade), but expressed as AnimatePresence enter/exit:
 * the panel grows from a small `origin` to its target shape on open, shrinks
 * back on close, with the content fading in over the size morph.
 *
 * Size is animated as raw width/height/borderRadius (never transform:scale, to
 * avoid distorting text). The caller owns positioning (wrap in a relative/fixed
 * anchor). `prefers-reduced-motion` → instant.
 */
interface MorphPanelProps {
  open: boolean
  /** Target shape. */
  width: number
  height: number
  radius?: number
  /** Collapsed shape the panel grows from / shrinks to. Defaults to a thin
   *  sliver near the top-left anchor (a "drop out" feel). */
  origin?: { width: number; height: number; radius?: number }
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}

export function MorphPanel({
  open,
  width,
  height,
  radius = 14,
  origin,
  className,
  style,
  children,
}: MorphPanelProps) {
  const reduced = useReducedMotion()
  const collapsed = origin ?? { width: Math.min(width, 72), height: 16, radius }
  const collapsedRadius = collapsed.radius ?? radius

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ width: collapsed.width, height: collapsed.height, borderRadius: collapsedRadius, opacity: 0 }}
          animate={{
            width,
            height,
            borderRadius: radius,
            opacity: 1,
            transition: reduced
              ? { duration: 0 }
              : { default: MORPH_SPRING, opacity: { duration: 0.16, ease: 'easeOut' } },
          }}
          // Closing: shrink back toward the trigger AND fade out together on a
          // short tween, so the panel dissolves cleanly instead of leaving a
          // sliver that pops. (Opening keeps the Wiscord island spring above.)
          exit={{
            width: collapsed.width,
            height: collapsed.height,
            borderRadius: collapsedRadius,
            opacity: 0,
            transition: reduced ? { duration: 0 } : { duration: 0.18, ease: [0.4, 0, 0.2, 1] },
          }}
          style={style}
          className={cn(
            'overflow-hidden bg-surface text-ink shadow-elevated',
            className,
          )}
        >
          <motion.div
            variants={MORPH_CONTENT_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="h-full w-full"
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
