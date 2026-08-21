'use client'

import { Sparkles } from 'lucide-react'

import { useBriefing } from '@/queries/planning'

/**
 * The Knowledge Agent's daily briefing, on the home screen.
 *
 * Renders nothing at all when there is nothing to say — a card that says "you
 * have 0 matters" is an empty state pretending to be information, and the home
 * screen already has a first-run state for a genuinely empty account.
 *
 * This card used to carry the clash list too. It no longer does, and the reason
 * is the bug that moved it: the briefing is scoped to TODAY, and this card only
 * renders at all when today has matters on it. So a user whose two clashing
 * matters were both next week opened the dashboard, saw nothing, and reasonably
 * concluded the app had not noticed — while every other surface knew. Clashes
 * now have `ConflictsCard`, which asks the account rather than the day and
 * appears on the strength of the clash itself.
 *
 * The headline and summary stay: `data.summary` still counts clashes, which is
 * the one place a today-scoped number about them is the right number.
 */
export function BriefingCard() {
  const { data, isPending } = useBriefing()

  if (isPending || !data || data.items.length === 0) return null

  return (
    <section className="rounded-3xl bg-surface-raised p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-accent" />
        <h2 className="text-label uppercase tracking-wide text-accent">{data.headline}</h2>
      </div>

      <p className="mt-2 text-body text-ink">{data.summary}</p>
    </section>
  )
}
