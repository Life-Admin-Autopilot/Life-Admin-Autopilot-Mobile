'use client'

import Link from 'next/link'
import { AlertTriangle, Sparkles } from 'lucide-react'

import { useBriefing } from '@/queries/planning'

/**
 * The Knowledge Agent's daily briefing, on the home screen.
 *
 * Renders nothing at all when there is nothing to say — a card that says "you
 * have 0 matters" is an empty state pretending to be information, and the home
 * screen already has a first-run state for a genuinely empty account.
 *
 * The clash list is the visible half of conflict re-checking: a user who never
 * opens a task detail still finds out that two things collide today.
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

      {data.conflicts.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 border-t border-hairline pt-3">
          {data.conflicts.map((conflict) => (
            <li key={conflict.taskId} className="flex items-start gap-1.5 text-body-sm text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <Link href={`/matters/${conflict.taskId}`} className="underline-offset-2 hover:underline">
                {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
