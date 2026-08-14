'use client'

import { Sparkles } from 'lucide-react'

import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'

/**
 * Free times this matter could move to instead.
 *
 * A refusal the user cannot act on is just an obstacle, and "Save anyway" is the
 * only escape a bare warning offers — which quietly pushes people toward keeping
 * the collision. These are the alternative, and they are one tap.
 *
 * The times are chosen for the KIND of matter, not just for emptiness: a film
 * gets an evening, a dentist gets working hours. Suggesting 09:00 for a movie is
 * not merely unhelpful — it reads as an assistant that was not listening.
 *
 * Every slot was checked against the same pool the save will be checked against,
 * so taking one cannot be refused a moment later.
 */
export function SuggestedSlots({
  slots,
  reason,
  onPick,
}: {
  slots: string[]
  reason: string
  onPick: (next: Date) => void
}) {
  const tag = useIntlTag()
  if (slots.length === 0) return null

  const now = new Date()

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <p className="flex items-center gap-1.5 text-caption text-ink-muted">
        <Sparkles size={12} className="shrink-0" />
        {reason ? `Free ${reason} instead` : 'Free instead'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {slots.map((iso) => {
          const at = new Date(iso)
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(at)}
              className="rounded-pill bg-accent/12 px-2.5 py-1 text-caption font-medium text-accent transition-colors hover:bg-accent/20"
            >
              {formatDayMonthMaybeYear(at, now, tag)}, {formatTime(at, tag)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
