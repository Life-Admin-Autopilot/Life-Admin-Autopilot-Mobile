import { cn } from '@/lib/cn'

export type StatTone = 'accent' | 'ink' | 'muted'

const VALUE_TONE: Record<StatTone, string> = {
  accent: 'text-accent',
  ink: 'text-ink',
  muted: 'text-ink-muted',
}

export interface Stat {
  value: number | string
  label: string
  tone?: StatTone
}

/**
 * Three numbers that belong to one thought ("today at a glance") read as one
 * object, not three. Separate tinted cards per metric turn a summary into a
 * competition — and on a 390px screen they force the captions to wrap.
 *
 * Exactly one number carries the accent: the one that is actually live.
 */
export function StatStrip({ stats, className }: { stats: readonly Stat[]; className?: string }) {
  return (
    <div className={cn('flex rounded-2xl bg-accent-soft px-2 py-4', className)}>
      {stats.map((s) => (
        <div key={s.label} className="flex flex-1 flex-col items-center gap-1">
          <span
            className={cn(
              'font-display text-display-md leading-none tabular',
              VALUE_TONE[s.tone ?? 'ink'],
            )}
          >
            {s.value}
          </span>
          <span className="whitespace-nowrap text-micro uppercase tracking-[0.08em] text-ink-muted">
            {s.label}
          </span>
        </div>
      ))}
    </div>
  )
}

/**
 * The standalone tile — a single number given room to be the point of its own
 * card. Built for a 2-up grid; at 3-up the captions have nowhere to go, which
 * is what StatStrip is for.
 */
export function StatTile({
  value,
  label,
  emoji,
  tone = 'accent',
  className,
}: {
  value: number | string
  label: string
  emoji?: string
  tone?: StatTone
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-2xl px-5 py-5',
        tone === 'muted' ? 'bg-surface-sunken' : 'bg-accent-soft',
        className,
      )}
    >
      {emoji ? (
        <span aria-hidden className="text-[18px] leading-none">
          {emoji}
        </span>
      ) : null}
      <span
        className={cn('font-display text-display-md leading-none tabular', VALUE_TONE[tone])}
      >
        {value}
      </span>
      <span className="text-micro uppercase leading-tight tracking-[0.08em] text-ink-muted">
        {label}
      </span>
    </div>
  )
}
