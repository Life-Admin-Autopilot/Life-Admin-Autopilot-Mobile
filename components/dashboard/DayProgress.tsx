import { cn } from '@/lib/cn'

/**
 * Today's progress as a pill: 🎉 3/8.
 *
 * This replaces the three-number stat strip that used to lead the dashboard.
 * That strip answered "how much do I have?" — an inventory question, and an
 * inventory that only ever grows is a scoreboard you are always losing. This
 * answers "how far have I got today?", which is a question with a good answer
 * on almost every day.
 *
 * It is deliberately scoped to TODAY. A lifetime completion count would drift
 * back into vanity metrics, and a streak would punish the first missed day.
 */
export function DayProgress({
  done,
  total,
  className,
}: {
  done: number
  total: number
  className?: string
}) {
  // Nothing scheduled means there is no progress to report — and a "0/0" pill
  // reads as failure when the truth is that the day is clear.
  if (total === 0) return null

  const complete = done >= total

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 shadow-card',
        complete ? 'bg-accent-soft' : 'bg-surface',
        className,
      )}
    >
      {/* Spelled out, not "3/8". A bare fraction on a pill is a puzzle — it
          gives no clue what is being counted or over what period, and the
          reader has to reverse-engineer both. The emoji only appears once the
          day is actually clear, where it means something. */}
      {complete ? (
        <span aria-hidden className="text-[13px] leading-none">
          🎉
        </span>
      ) : null}
      <span className="text-body-sm font-bold text-ink">
        <span className="tabular">{done}</span> of <span className="tabular">{total}</span> today
      </span>
    </span>
  )
}
