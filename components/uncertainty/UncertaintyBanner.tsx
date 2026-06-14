'use client'

import Link from 'next/link'
import { HelpCircle, ChevronRight } from 'lucide-react'

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
      className="mx-auto flex max-w-md items-center gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 shadow-card"
    >
      <HelpCircle size={20} className="shrink-0 text-accent" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-sm font-medium text-ink">
          {count} {count === 1 ? 'matter needs' : 'matters need'} your input
        </span>
        <span className="text-caption text-ink-muted">Pick an answer or type your own — fast.</span>
      </div>
      <ChevronRight size={18} className="shrink-0 text-accent" />
    </Link>
  )
}
