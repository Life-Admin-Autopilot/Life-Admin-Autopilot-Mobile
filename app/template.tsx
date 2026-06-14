'use client'

import { motion, useReducedMotion } from 'framer-motion'

import { MORPH_PAGE_VARIANTS } from '@/lib/motion'

// App Router template — re-mounts on every navigation, so each route's content
// "expands in" with the morph spring (enter-only; see MORPH_PAGE_VARIANTS).
// Reduced motion → render plain. This is a client SPA (static export), so JS
// always hydrates and the initial opacity resolves immediately.
export default function Template({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion()
  if (reduced) return <>{children}</>

  return (
    <motion.div variants={MORPH_PAGE_VARIANTS} initial="initial" animate="animate">
      {children}
    </motion.div>
  )
}
