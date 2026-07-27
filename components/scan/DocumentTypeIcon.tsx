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
const MAP: Record<ScanDocumentType, { emoji: string; category: CatColor; label: string }> = {
  bill: { emoji: '🧾', category: 'sky', label: 'Bill' },
  statement: { emoji: '📊', category: 'sky', label: 'Statement' },
  receipt: { emoji: '🧾', category: 'peach', label: 'Receipt' },
  tax: { emoji: '🏛️', category: 'periwinkle', label: 'Tax document' },
  legal: { emoji: '⚖️', category: 'periwinkle', label: 'Legal document' },
  insurance: { emoji: '🛡️', category: 'lilac', label: 'Insurance' },
  identity: { emoji: '🪪', category: 'lilac', label: 'Identity document' },
  medical: { emoji: '🩺', category: 'sage', label: 'Medical document' },
  letter: { emoji: '✉️', category: 'blush', label: 'Letter' },
  form: { emoji: '📋', category: 'blush', label: 'Form' },
  other: { emoji: '📄', category: 'yellow', label: 'Document' },
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
  const { emoji, category, label } = MAP[type ?? 'other']
  return (
    <EmojiChip
      emoji={emoji}
      category={category}
      size={size}
      square
      label={label}
      className={cn(type === undefined || type === 'other' ? 'opacity-90' : undefined, className)}
    />
  )
}
