'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { CircleCheck } from 'lucide-react'

import { MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'

/**
 * Toast body that morphs in — a small pill grows into the full notification
 * with the Wiscord spring + content fade. Rendered via sonner's `toast.custom`
 * (sonner owns stacking/dismiss; framer owns the morph-in).
 */
export function MorphToast({ title, description }: { title: string; description?: string }) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      initial={reduced ? false : { width: 44, height: 34, borderRadius: 17 }}
      animate={{ width: 232, height: description ? 56 : 42, borderRadius: 14 }}
      transition={reduced ? { duration: 0 } : MORPH_SPRING}
      className="overflow-hidden border border-border bg-surface text-ink shadow-elevated"
    >
      <motion.div
        variants={MORPH_CONTENT_VARIANTS}
        initial={reduced ? false : 'initial'}
        animate="animate"
        className="flex h-full items-center gap-2.5 px-3.5"
      >
        <CircleCheck size={16} className="shrink-0 text-accent" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-caption font-medium text-ink">{title}</span>
          {description ? (
            <span className="truncate text-micro text-ink-muted">{description}</span>
          ) : null}
        </div>
      </motion.div>
    </motion.div>
  )
}
