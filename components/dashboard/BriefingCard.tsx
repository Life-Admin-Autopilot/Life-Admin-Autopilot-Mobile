'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AlertTriangle, Sparkles } from 'lucide-react'

import { useBriefing } from '@/queries/planning'
import type { DraftConflict } from '@/queries/planning'

/**
 * The Knowledge Agent's daily briefing, on the home screen.
 *
 * Renders nothing at all when there is nothing to say — a card that says "you
 * have 0 matters" is an empty state pretending to be information, and the home
 * screen already has a first-run state for a genuinely empty account.
 *
 * The clash list is the visible half of conflict re-checking: a user who never
 * opens a task detail still finds out that two things collide today. It is a
 * BRIEF: the summary sentence above already carries the count, so this block
 * shows the first few concrete clashes and one quiet line for the rest —
 * never the whole ledger. A day with 47 clashes is a day that needs three
 * examples and a number, not 47 amber rows.
 */

/** How many clash rows earn a place on the home screen. */
const MAX_CLASH_ROWS = 3

/**
 * One row per matter. The server dedupes clash PAIRS ("A with B" counted
 * once), so a matter colliding with two others arrives twice with the same
 * taskId — real data, but on a briefing one mention per matter is enough.
 */
function dedupeByTask(conflicts: DraftConflict[]): DraftConflict[] {
  const seen = new Set<string>()
  return conflicts.filter((c) => {
    if (seen.has(c.taskId)) return false
    seen.add(c.taskId)
    return true
  })
}

export function BriefingCard() {
  const t = useTranslations('dashboard.briefing')
  const { data, isPending } = useBriefing()

  if (isPending || !data || data.items.length === 0) return null

  const clashes = dedupeByTask(data.conflicts)
  const visible = clashes.slice(0, MAX_CLASH_ROWS)
  const hidden = clashes.length - visible.length

  // The server's reason string was written for the task-detail screen, where
  // "this" is the task being viewed; on the home screen it has no referent.
  // Known kinds get copy written for THIS surface; an unknown kind falls back
  // to the server's sentence rather than guessing.
  const suffixFor = (c: DraftConflict): string =>
    c.kind === 'time_clash'
      ? t('clashTimeSuffix')
      : c.kind === 'duplicate'
        ? t('clashDuplicateSuffix')
        : c.reason

  return (
    <section className="rounded-3xl bg-surface-raised p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles size={14} className="text-accent" />
        <h2 className="text-label uppercase tracking-wide text-accent">{data.headline}</h2>
      </div>

      <p className="mt-2 text-body text-ink">{data.summary}</p>

      {visible.length > 0 ? (
        <div className="mt-3 border-t border-hairline pt-3">
          <ul className="flex flex-col gap-1.5">
            {visible.map((conflict) => (
              <li key={conflict.taskId} className="flex items-start gap-1.5 text-body-sm">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                <Link
                  href={`/matters/${conflict.taskId}`}
                  className="text-ink underline-offset-2 hover:underline"
                  dir="auto"
                >
                  {conflict.title} <span className="text-ink-muted">— {suffixFor(conflict)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <p className="mt-2 text-body-sm text-ink-muted">
              <Link href="/matters" className="underline-offset-2 hover:underline">
                {t('moreClashes', { count: hidden })}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
