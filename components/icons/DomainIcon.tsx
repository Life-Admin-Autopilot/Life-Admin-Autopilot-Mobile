import { HeartPulse, House, Car, Landmark, Users, PawPrint, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'

// Domain identity chip — a low-chroma stone tint + an outline glyph (never an
// emoji; AGENTS.md → Icons). Driven by the domain stone tokens in globals.
export type Domain = 'health' | 'home' | 'car' | 'finance' | 'family' | 'pets'

const MAP: Record<Domain, { icon: LucideIcon; bg: string; ink: string }> = {
  health: { icon: HeartPulse, bg: 'bg-domain-health', ink: 'text-domain-health-ink' },
  home: { icon: House, bg: 'bg-domain-home', ink: 'text-domain-home-ink' },
  car: { icon: Car, bg: 'bg-domain-car', ink: 'text-domain-car-ink' },
  finance: { icon: Landmark, bg: 'bg-domain-finance', ink: 'text-domain-finance-ink' },
  family: { icon: Users, bg: 'bg-domain-family', ink: 'text-domain-family-ink' },
  pets: { icon: PawPrint, bg: 'bg-domain-pets', ink: 'text-domain-pets-ink' },
}

export function DomainIcon({
  domain,
  size = 36,
  className,
}: {
  domain: Domain
  size?: number
  className?: string
}) {
  const { icon: Icon, bg, ink } = MAP[domain]
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-md', bg, className)}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} className={ink} />
    </span>
  )
}
