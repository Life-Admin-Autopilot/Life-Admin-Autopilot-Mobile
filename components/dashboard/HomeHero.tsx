import { GhostLogo } from '@/components/ui/GhostLogo'

function greeting(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function longDate(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// The hero greets and dates the day, and stops there.
//
// It used to also carry three counts and an "N matters require attention" line.
// Both are gone: the card directly beneath now names the single thing that
// needs the user, which is a better answer to the same question, and a total
// stated twice in 200px is just noise. What remains of the numbers is the
// progress pill — passed in as a slot so the hero does not need to know how
// today's completions are counted.
//
// `now` is passed in so the greeting is deterministic at the call site
// (Date.now() isn't available everywhere).
export function HomeHero({
  name,
  now,
  summary,
  progress,
}: {
  name: string
  now: Date
  /**
   * The digest's one written sentence. It lives here rather than in a card of
   * its own: as a card it was a full-width panel whose only content was prose
   * the user had already scrolled past the answer to. As a line under the
   * greeting it costs nothing and reads as the app talking, which is what it is.
   */
  summary?: string
  progress?: React.ReactNode
}) {
  return (
    <section className="flex flex-col items-center text-center">
      <GhostLogo size={116} priority label="Your companion, ready to help" />

      {/* The DAY is the headline, not the greeting. A greeting is charming the
          first time and furniture every time after; the date is useful on every
          open. Demoting the greeting to the line beneath keeps the warmth and
          gives back the ~130px the 44px two-line version was spending. */}
      <h1
        className="mt-2 font-display text-display-md text-balance text-ink"
        suppressHydrationWarning
      >
        {longDate(now)}
      </h1>
      <p className="mt-1 text-body text-ink-muted" suppressHydrationWarning>
        {greeting(now)}, {name}.
      </p>

      {/* Serif, because this is the one sentence the app writes rather than
          counts — the same voice the headline uses, at a whisper. */}
      {summary ? (
        <p className="mt-2.5 max-w-[34ch] font-display text-body text-balance text-ink-muted">
          {summary}
        </p>
      ) : null}

      {progress ? <div className="mt-3.5">{progress}</div> : null}
    </section>
  )
}
