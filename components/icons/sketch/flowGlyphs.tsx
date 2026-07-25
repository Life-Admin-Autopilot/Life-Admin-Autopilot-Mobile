import { SketchGlyph } from '@/components/icons/sketch/SketchGlyph'
import { cn } from '@/lib/cn'

// Hand-drawn glyphs for the document capture/upload/review/success flow —
// see docs/aesthetic.md; scoped to this flow only, not a DomainIcon swap.
interface GlyphProps {
  size?: number
  className?: string
}

export function SketchCameraGlyph({ size = 28, className }: GlyphProps) {
  return (
    <SketchGlyph size={size} className={className}>
      <path d="M12 10.5 L13.5 7.5 H18.5 L20 10.5" />
      <rect x="5" y="10.5" width="22" height="15" rx="3" />
      <circle cx="16" cy="18" r="5" />
      <circle cx="22.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </SketchGlyph>
  )
}

export function SketchUploadGlyph({ size = 28, className }: GlyphProps) {
  return (
    <SketchGlyph size={size} className={className}>
      <path d="M16 4 L10 10.5" />
      <path d="M16 4 L22 10.5" />
      <path d="M16 4 V19" />
      <path d="M7 21 V25.5 Q7 27 8.5 27 H23.5 Q25 27 25 25.5 V21" />
    </SketchGlyph>
  )
}

export function SketchScanGlyph({ size = 28, className }: GlyphProps) {
  return (
    <SketchGlyph size={size} className={className}>
      <path d="M16 4 C17 10 18 14 26 16 C18 18 17 22 16 28 C15 22 14 18 6 16 C14 14 15 10 16 4 Z" />
      <path d="M24 6 C24.4 7.6 25 8.2 26.6 8.6 C25 9 24.4 9.6 24 11.2 C23.6 9.6 23 9 21.4 8.6 C23 8.2 23.6 7.6 24 6 Z" />
    </SketchGlyph>
  )
}

export function SketchCheckGlyph({ size = 28, className }: GlyphProps) {
  return (
    <SketchGlyph size={size} className={className}>
      <path d="M16 4.5 C22 4 27.5 8.5 27.5 15 C27.5 21.5 22 27 16 27.5 C10 27 4.5 21.5 4.5 15 C4.5 8.5 10 4 16 4.5 Z" />
      <path d="M11 16 L14.5 19.5 L21.5 11.5" />
    </SketchGlyph>
  )
}

export function SketchEmptyTrayGlyph({ size = 96, className }: GlyphProps) {
  return (
    <SketchGlyph size={size} className={cn('text-ink-subtle', className)} strokeWidth={1.4}>
      <path d="M5 17 L7 8 H25 L27 17" />
      <path d="M5 17 L9.5 17 L12 20.5 H20 L22.5 17 H27" />
      <path d="M5 17 V24.5 Q5 26 6.5 26 H25.5 Q27 26 27 24.5 V17" />
    </SketchGlyph>
  )
}
