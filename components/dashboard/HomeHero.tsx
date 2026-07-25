import Image from 'next/image'

import pandaImg from '@/assets/panda/hero-image.png'

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Home hero — the panda over lavender, a rounded greeting by name, a friendly
// status line, and the three stat cards. `now` is passed in so the greeting is
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
    <section className="flex flex-col items-center px-6 pt-6 text-center">
      <div className="flex w-full justify-center bg-transparent pt-2">
        <Image
          src={pandaImg}
          alt="Our panda companion, ready to help"
          priority
          className="h-[220px] opacity-[0.85] w-auto object-contain"
          style={{ scale: '1', position: 'relative', top: '0px' }}
        />
      </div>
      <h1 className="mt-4 font-display text-display-hero text-ink" suppressHydrationWarning>
        {greeting(now)}, {name}.
      </h1>
      <p className="mt-1 text-body text-ink-muted">
        <span className="text-accent">
          {attention} {attention === 1 ? 'matter' : 'matters'}
        </span>{' '}
        require attention.
      </p>

      <div className="mt-3 grid w-full grid-cols-3 gap-3 pt-1">
        <Stat n={stats.all} label="All matters" />
        <Stat n={stats.due} label="Due soon" />
        <Stat n={stats.resolved} label="Resolved" muted />
      </div>
    </section>
  )
}

function Stat({ n, label, muted }: { n: number; label: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg">
      <span
        className={`font-display text-display-md tabular ${muted ? 'text-ink-muted' : 'text-accent'}`}
      >
        {n}
      </span>
      <span className="text-caption text-ink-muted">{label}</span>
    </div>
  )
}
