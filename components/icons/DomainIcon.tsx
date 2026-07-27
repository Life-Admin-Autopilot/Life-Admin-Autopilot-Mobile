import { HeartPulse, House, Car, Landmark, Users, PawPrint, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'
import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'

// Domain identity chip. The default is the emoji-in-pastel-circle — the
// signature mark of the design system — with the lucide outline kept behind
// `variant="glyph"` for the surfaces where a full-colour emoji would shout
// (dense review tables, the scan flow's hand-drawn set).
export type Domain = 'health' | 'home' | 'car' | 'finance' | 'family' | 'pets'

interface DomainStyle {
  icon: LucideIcon
  emoji: string
  category: CatColor
  bg: string
  ink: string
  label: string
}

const MAP: Record<Domain, DomainStyle> = {
  health: {
    icon: HeartPulse,
    emoji: '🩺',
    category: 'sage',
    bg: 'bg-domain-health',
    ink: 'text-domain-health-ink',
    label: 'Health',
  },
  home: {
    icon: House,
    emoji: '🏠',
    category: 'peach',
    bg: 'bg-domain-home',
    ink: 'text-domain-home-ink',
    label: 'Home',
  },
  car: {
    icon: Car,
    emoji: '🚗',
    category: 'periwinkle',
    bg: 'bg-domain-car',
    ink: 'text-domain-car-ink',
    label: 'Car',
  },
  finance: {
    icon: Landmark,
    emoji: '💳',
    category: 'sky',
    bg: 'bg-domain-finance',
    ink: 'text-domain-finance-ink',
    label: 'Finance',
  },
  family: {
    icon: Users,
    emoji: '👨‍👩‍👧',
    category: 'blush',
    bg: 'bg-domain-family',
    ink: 'text-domain-family-ink',
    label: 'Family',
  },
  pets: {
    icon: PawPrint,
    emoji: '🐾',
    category: 'lilac',
    bg: 'bg-domain-pets',
    ink: 'text-domain-pets-ink',
    label: 'Pets',
  },
}

export function domainEmoji(domain: Domain): string {
  return MAP[domain].emoji
}

export function domainCategory(domain: Domain): CatColor {
  return MAP[domain].category
}

export function DomainIcon({
  domain,
  size = 44,
  variant = 'emoji',
  className,
}: {
  domain: Domain
  size?: number
  variant?: 'emoji' | 'glyph'
  className?: string
}) {
  const { icon: Icon, emoji, category, bg, ink, label } = MAP[domain]

  if (variant === 'emoji') {
    return (
      <EmojiChip
        emoji={emoji}
        category={category}
        size={size}
        label={label}
        className={className}
      />
    )
  }

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', bg, className)}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.75} className={ink} />
    </span>
  )
}
