import { SketchGlyph } from '@/components/icons/sketch/SketchGlyph'
import type { Domain } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'

// Hand-drawn domain glyphs for the document review flow only — a deliberate
// departure from DomainIcon's lucide-in-a-pastel-chip convention used
// everywhere else (dashboard, matters). No chip background: the loose ink
// stroke and a geometric tinted container don't blend well at small sizes,
// so this commits fully to the sketched register instead of mixing the two.
const PATHS: Record<Domain, React.ReactNode> = {
  health: (
    <>
      <path d="M16 26 C6 19 3 13 6.5 9 C9 6 13.5 6.5 16 11 C18.5 6.5 23 6 25.5 9 C29 13 26 19 16 26 Z" />
      <path d="M9 15 H13 L15 11 L18 19 L20 15 H23.5" />
    </>
  ),
  home: (
    <>
      <path d="M6 16 L16 6.5 L26 16" />
      <path d="M9 14 V26 H23 V14" />
      <path d="M13.5 26 V19 H18.5 V26" />
    </>
  ),
  car: (
    <>
      <path d="M6 19 L8 12.5 Q9 11 11 11 H21 Q23 11 24 12.5 L26 19" />
      <path d="M4.5 19 H27.5 V23 H4.5 Z" />
      <circle cx="10.5" cy="23.5" r="2.3" />
      <circle cx="21.5" cy="23.5" r="2.3" />
    </>
  ),
  finance: (
    <>
      <circle cx="16" cy="16" r="10.5" />
      <path d="M16 10 V22" />
      <path d="M12.5 13 H18 Q20 13 20 15 Q20 16.7 18 16.7 H14 Q12 16.7 12 18.4 Q12 20 14 20 H19.5" />
    </>
  ),
  family: (
    <>
      <circle cx="12.5" cy="10.5" r="3.3" />
      <path d="M6.5 25 C6.5 19.5 9 17 12.5 17 C16 17 18.5 19.5 18.5 25" />
      <circle cx="21" cy="12.5" r="2.8" />
      <path d="M16.5 25 C16.8 20.7 18.7 18.5 21.5 18.5 C24.3 18.5 26.2 20.7 26.2 25" />
    </>
  ),
  pets: (
    <>
      <circle cx="16" cy="20.5" r="4.2" />
      <circle cx="9.5" cy="14" r="2.3" />
      <circle cx="15" cy="10.5" r="2.4" />
      <circle cx="21.5" cy="10.8" r="2.3" />
      <circle cx="24.5" cy="15.5" r="2.1" />
    </>
  ),
}

export function SketchDomainIcon({
  domain,
  size = 28,
  className,
}: {
  domain: Domain
  size?: number
  className?: string
}) {
  return (
    <SketchGlyph size={size} className={cn('text-ink-muted', className)}>
      {PATHS[domain]}
    </SketchGlyph>
  )
}
