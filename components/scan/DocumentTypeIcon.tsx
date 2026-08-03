'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import type { ScanDocumentType } from '@/queries/documentScans'

// Leading identity tile for a document row. Same construction as DomainIcon so
// the two icon systems read as one family — but a ROUNDED SQUARE rather than a
// circle, which is what distinguishes "a document" from "a matter" at a glance
// in a mixed list.
//
// Colour carries the CATEGORY, the emoji carries the specific type: everything
// financial is sky, everything correspondence-shaped is blush, and so on. The
// tints come from the shared pastel palette instead of eleven newly invented
// hues — a row of eleven unrelated colours would read as a toy. `other` stays
// deliberately neutral: an unclassified document should not be handed a false
// identity by colour.
//
// The MAP carries only what is language-independent. The accessible NAME is
// looked up per render instead — a module-level const cannot call a hook, and
// baking eleven English labels in here is exactly how the tile ended up being
// the one thing on the row that never translated.
const MAP: Record<ScanDocumentType, { emoji: string; category: CatColor }> = {
  bill: { emoji: '🧾', category: 'sky' },
  statement: { emoji: '📊', category: 'sky' },
  receipt: { emoji: '🧾', category: 'peach' },
  tax: { emoji: '🏛️', category: 'periwinkle' },
  legal: { emoji: '⚖️', category: 'periwinkle' },
  insurance: { emoji: '🛡️', category: 'lilac' },
  identity: { emoji: '🪪', category: 'lilac' },
  medical: { emoji: '🩺', category: 'sage' },
  letter: { emoji: '✉️', category: 'blush' },
  form: { emoji: '📋', category: 'blush' },
  other: { emoji: '📄', category: 'yellow' },
}

export function DocumentTypeIcon({
  type,
  size = 44,
  className,
}: {
  // Undefined for every document scanned before the type field existed — those
  // fall through to `other` rather than breaking the row.
  type: ScanDocumentType | undefined
  size?: number
  className?: string
}) {
  const t = useTranslations('scan')
  const resolved = type ?? 'other'
  const { emoji, category } = MAP[resolved]
  return (
    <EmojiChip
      emoji={emoji}
      category={category}
      size={size}
      square
      label={t(`docType.${resolved}`)}
      className={cn(type === undefined || type === 'other' ? 'opacity-90' : undefined, className)}
    />
  )
}
