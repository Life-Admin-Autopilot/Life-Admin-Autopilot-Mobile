'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import { useVoiceCapture } from '@/lib/voice/captureStore'

/**
 * The four ways in, as a list.
 *
 * The home screen answers "what needs me right now?", and on a day where the
 * answer is "nothing" it used to answer it with an empty screen — a greeting, a
 * sentence, and then a page of nothing until the tab bar. That reads as an app
 * with nothing in it rather than a day with nothing due.
 *
 * A LIST, not a row of square tiles. Four tiles across is four one-word labels
 * competing at the same weight, which is a launcher — the user has to already
 * know what each one does. Rows have room for a second line, so each route can
 * say what it is for, and they scan top-to-bottom like everything else on this
 * screen instead of introducing a second reading direction.
 *
 * This is NOT the first-run strip. `FirstRunState` teaches an empty account what
 * the app is for and only renders once; these stay put on every day, busy or
 * clear, so their position is learnable.
 *
 * Capture leads, and is the one row with a tint behind it: speaking is both the
 * fastest way in and the one route with no tab-bar equivalent a user would think
 * to look for.
 */
interface QuickLink {
  key: string
  emoji: string
  category: CatColor
  title: string
  body: string
  href?: string
}

type QuickLinksT = ReturnType<typeof useTranslations<'dashboard.quickLinks'>>

// A function, not a module-level const, for the same reason FirstRunState's
// route list is: a const evaluates at import time, where no translator exists.
function links(t: QuickLinksT): QuickLink[] {
  return [
    {
      key: 'speak',
      emoji: '🎙️',
      category: 'blush',
      title: t('speakTitle'),
      body: t('speakBody'),
    },
    {
      key: 'scan',
      emoji: '📄',
      category: 'yellow',
      title: t('scanTitle'),
      body: t('scanBody'),
      href: '/documents',
    },
    {
      key: 'matters',
      emoji: '🗂️',
      category: 'periwinkle',
      title: t('mattersTitle'),
      body: t('mattersBody'),
      href: '/matters',
    },
    {
      key: 'money',
      emoji: '💰',
      category: 'sage',
      title: t('moneyTitle'),
      body: t('moneyBody'),
      href: '/money',
    },
  ]
}

export function QuickLinks() {
  const t = useTranslations('dashboard.quickLinks')
  const openCapture = useVoiceCapture((s) => s.openCapture)

  return (
    <section aria-label={t('title')} className="flex flex-col gap-2">
      {links(t).map((link) => {
        const content = (
          <>
            <EmojiChip emoji={link.emoji} category={link.category} size={38} />
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="truncate text-heading-sm text-ink">{link.title}</span>
              <span className="truncate text-body-sm text-ink-muted">{link.body}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-subtle rtl:rotate-180" />
          </>
        )

        const className =
          'flex w-full items-center gap-3.5 rounded-2xl px-4 py-3 shadow-card transition-transform active:scale-[0.99]'

        // Tinted behind the leading row only — see the note above on why the
        // other three stay quiet.
        if (!link.href) {
          return (
            <button
              key={link.key}
              type="button"
              onClick={openCapture}
              className={`${className} bg-accent-soft`}
            >
              {content}
            </button>
          )
        }

        return (
          <Link key={link.key} href={link.href} className={`${className} bg-surface`}>
            {content}
          </Link>
        )
      })}
    </section>
  )
}
