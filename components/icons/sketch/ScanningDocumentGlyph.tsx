'use client'

// Animated "reading a document" indicator for the processing phase — a
// hand-drawn page outline (same double-stroke sketch technique as
// SketchGlyph) with a soft accent glow sweeping top to bottom, looping.
// Replaces a static sparkle glyph, which read as broken rather than "busy."
// Honors prefers-reduced-motion (glow settles mid-page, no sweep).

import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

export function ScanningDocumentGlyph({ size = 80, className }: { size?: number; className?: string }) {
  const reduced = useReducedMotion()
  const clipId = useId()
  const gradId = useId()

  return (
    <svg
      viewBox="0 0 32 37"
      width={size}
      height={size * 1.15625}
      fill="none"
      className={className}
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="5" y="3" width="22" height="31" rx="2.5" />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="0.5" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* faint offset echo, same double-stroke sketch texture as SketchGlyph */}
      <g
        opacity={0.3}
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0.5 0.6) rotate(1 16 18)"
      >
        <rect x="5" y="3" width="22" height="31" rx="2.5" />
        <path d="M9.5 12 H22.5" />
        <path d="M9.5 17 H22.5" />
        <path d="M9.5 22 H18" />
      </g>
      <g stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="3" width="22" height="31" rx="2.5" />
        <path d="M9.5 12 H22.5" />
        <path d="M9.5 17 H22.5" />
        <path d="M9.5 22 H18" />
      </g>

      <g clipPath={`url(#${clipId})`}>
        <motion.rect
          x="5"
          width="22"
          height="12"
          fill={`url(#${gradId})`}
          initial={{ y: -12 }}
          animate={reduced ? { y: 13 } : { y: [-12, 34] }}
          transition={reduced ? { duration: 0 } : { duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
        />
      </g>
    </svg>
  )
}
