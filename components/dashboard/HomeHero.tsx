'use client'

import { useTranslations } from 'next-intl'

import { GhostLogo } from '@/components/ui/GhostLogo'
import { useIntlTag } from '@/lib/i18n/localeStore'

// Both helpers stay module-level — they are pure formatting, and a component
// that inlines them re-reads as layout rather than logic. Neither may call a
// hook from out here, so the translator and the Intl tag are ARGUMENTS: the
// same shape lib/i18n/translate.ts exists for, and the one
// components/profile/CalendarFeedsSheet.tsx already uses.
type HeroT = ReturnType<typeof useTranslations<'dashboard.hero'>>

function greeting(d: Date, t: HeroT): string {
  const h = d.getHours()
  if (h < 12) return t('morning')
  if (h < 18) return t('afternoon')
  return t('evening')
}

// `tag`, never `undefined` — the ambient default is the device's language, and
// this app's language is a setting the user owns. An Arabic reader on an English
// phone must not get an English weekday under an Arabic greeting.
function longDate(d: Date, tag: string): string {
  return d.toLocaleDateString(tag, { weekday: 'long', month: 'long', day: 'numeric' })
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
  const t = useTranslations('dashboard.hero')
  const tag = useIntlTag()

  return (
    <section className="flex flex-col items-center text-center">
      <GhostLogo size={116} priority label={t('logoLabel')} />

      {/* The DAY is the headline, not the greeting. A greeting is charming the
          first time and furniture every time after; the date is useful on every
          open. Demoting the greeting to the line beneath keeps the warmth and
          gives back the ~130px the 44px two-line version was spending. */}
      <h1
        className="mt-2 font-display text-display-md text-balance text-ink"
        suppressHydrationWarning
      >
        {longDate(now, tag)}
      </h1>
      {/* One sentence, one key. Composing "{greeting}, {name}." in JSX would
          hard-code an English comma between two translated halves; Arabic wants
          a vocative particle there instead. */}
      <p className="mt-1 text-body text-ink-muted" suppressHydrationWarning>
        {t('greetingLine', { greeting: greeting(now, t), name })}
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
