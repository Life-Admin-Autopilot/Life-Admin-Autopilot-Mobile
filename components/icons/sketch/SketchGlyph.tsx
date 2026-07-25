import { cn } from '@/lib/cn'

// Shared stroke DNA for the document-flow's hand-drawn icon set (scoped to
// this flow only — see docs/aesthetic.md's DomainIcon convention elsewhere).
// The "sketched in a notebook" read comes from a faint, slightly offset/
// rotated echo of the same path rendered behind a crisp primary line, rather
// than hand-perturbed bezier data per glyph — cheap, and keeps every glyph's
// line quality consistent across the set.
interface SketchGlyphProps {
  size?: number
  viewBox?: string
  strokeWidth?: number
  className?: string
  children: React.ReactNode
}

export function SketchGlyph({
  size = 28,
  viewBox = '0 0 32 32',
  strokeWidth = 1.6,
  className,
  children,
}: SketchGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('overflow-visible', className)}
    >
      <g opacity={0.32} strokeWidth={strokeWidth * 0.85} transform="translate(0.55 0.65) rotate(1.4 16 16)">
        {children}
      </g>
      <g>{children}</g>
    </svg>
  )
}
