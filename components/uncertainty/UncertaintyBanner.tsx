'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

import { EmojiChip } from '@/components/ui/EmojiChip'
import { useClarifications } from '@/queries/clarifications'

// Dashboard surface for the AI's held items. Appears only when there are open
// uncertainties; tapping opens the fast fill-everything stack.
export function UncertaintyBanner() {
  const { data } = useClarifications()
  const count = data?.clarifications.length ?? 0
  if (count === 0) return null

  return (
    <Link
      href="/uncertainties"
      className="mx-auto flex max-w-md items-center gap-3.5 rounded-2xl bg-accent-soft px-4 py-3.5"
    >
      <EmojiChip emoji="💭" category="blush" size={40} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-heading-sm text-ink">
          {count} {count === 1 ? 'matter needs' : 'matters need'} your input
        </span>
        <span className="truncate text-body-sm text-ink-muted">
          Pick an answer or type your own.
        </span>
      </div>
      <ChevronRight size={18} className="shrink-0 text-accent" />
    </Link>
  )
}
