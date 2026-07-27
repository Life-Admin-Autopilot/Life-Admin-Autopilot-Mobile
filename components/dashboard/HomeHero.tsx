import { GhostLogo } from '@/components/ui/GhostLogo'
import { StatStrip } from '@/components/ui/StatTile'

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// Home hero — the mascot (eyes live, looking around), a serif greeting by
// name, the date, and the stat strip. `now` is passed in so the greeting is
// deterministic at the call site (Date.now() isn't available everywhere).
export function HomeHero({
  name,
  now,
  attention = 5,
  stats = { all: 8, due: 5, resolved: 3 },
}: {
  name: string
  now: Date
  attention?: number
  stats?: { all: number; due: number; resolved: number }
}) {
  return (
    <section className="flex flex-col items-center px-5 text-center">
      <GhostLogo size={180} priority label="Your companion, ready to help" />

      <h1
        className="mt-3 font-display text-display-hero text-balance text-ink"
        suppressHydrationWarning
      >
        {greeting(now)}, {name}.
      </h1>
      <p className="mt-1.5 text-body text-ink-muted" suppressHydrationWarning>
        {longDate(now)}
      </p>
      <p className="mt-1 text-body text-ink-muted">
        <span className="font-bold text-accent tabular">{attention}</span>{' '}
        {attention === 1 ? 'matter needs' : 'matters need'} attention.
      </p>

      <StatStrip
        className="mt-6 w-full max-w-md"
        stats={[
          { value: stats.all, label: 'All', tone: 'ink' },
          { value: stats.due, label: 'Due soon', tone: 'accent' },
          { value: stats.resolved, label: 'Resolved', tone: 'muted' },
        ]}
      />
    </section>
  )
}
