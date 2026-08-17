'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import { useVoiceCapture } from '@/lib/voice/captureStore'

/**
 * The four ways in, as one row of tiles.
 *
 * The home screen answers "what needs me right now?", and on a day where the
 * answer is "nothing" it used to answer it with an empty screen — a greeting, a
 * sentence, and then a page of nothing until the tab bar. That reads as an app
 * with nothing in it rather than a day with nothing due.
 *
 * This is NOT the first-run strip. `FirstRunState` teaches an empty account
 * what the app is for, in full sentences, and only renders once. These are
 * shortcuts for someone who already knows — emoji, one word, no explanation —
 * and they stay put on every day, busy or clear, so their position is learnable.
 *
 * Capture leads, and is the one tile with a tint behind it: speaking is both the
 * fastest way in and the one route with no tab-bar equivalent that a user would
 * think to look for. The rest are quiet on purpose; four equally loud tiles is
 * four decisions, which is the thing the dashboard is built to avoid.
 */
interface QuickLink {
  key: string
  emoji: string
  category: CatColor
  label: string
  href?: string
}

type QuickLinksT = ReturnType<typeof useTranslations<'dashboard.quickLinks'>>

// A function, not a module-level const, for the same reason FirstRunState's
// route list is: a const evaluates at import time, where no translator exists.
function links(t: QuickLinksT): QuickLink[] {
  return [
    { key: 'speak', emoji: '🎙️', category: 'blush', label: t('speak') },
    { key: 'scan', emoji: '📄', category: 'yellow', label: t('scan'), href: '/documents' },
    { key: 'matters', emoji: '🗂️', category: 'periwinkle', label: t('matters'), href: '/matters' },
    { key: 'money', emoji: '💰', category: 'sage', label: t('money'), href: '/money' },
  ]
}

export function QuickLinks() {
  const t = useTranslations('dashboard.quickLinks')
  const openCapture = useVoiceCapture((s) => s.openCapture)

  return (
    <section aria-label={t('title')} className="grid grid-cols-4 gap-2">
      {links(t).map((link) => {
        const content = (
          <>
            <EmojiChip emoji={link.emoji} category={link.category} size={38} />
            <span className="w-full truncate text-center text-micro font-bold text-ink-muted">
              {link.label}
            </span>
          </>
        )

        // Tinted behind the leading tile only — see the note above on why the
        // other three stay quiet.
        const className =
          'flex flex-col items-center gap-2 rounded-2xl px-1.5 py-3 shadow-card transition-transform active:scale-[0.96]'

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
