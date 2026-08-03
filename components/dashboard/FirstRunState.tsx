'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import { useVoiceCapture } from '@/lib/voice/captureStore'

/**
 * The first-run screen — no matters, none ever completed.
 *
 * This is a DIFFERENT state from a clear day and must not borrow its copy.
 * "Rest, you're all caught up" to someone who has never added anything is
 * meaningless: they haven't done anything to be caught up on, and the sentence
 * quietly implies the app is already working when it has nothing to work with.
 *
 * The failure to avoid here is blank-slate paralysis — a calm, beautiful, empty
 * screen that offers no way in. So this state does the one thing the clear-day
 * state deliberately refuses to do: it suggests. Three concrete openings, each
 * a real capture route the app already has, phrased as things you might say
 * rather than features you might configure.
 */
interface StartRoute {
  key: string
  emoji: string
  category: CatColor
  title: string
  body: string
}

// A FUNCTION, not a const. The list used to be a module-level literal, which
// is exactly the shape that cannot be translated: a `const` evaluates once at
// import time, before any provider exists, and a hook cannot be called from out
// here to reach one. Taking the translator as an argument keeps the list where
// it reads best — beside the type it satisfies — and still resolves per render,
// so switching language in Settings re-renders these three rows.
type FirstRunT = ReturnType<typeof useTranslations<'dashboard.firstRun'>>

function routes(t: FirstRunT): StartRoute[] {
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
    },
    {
      key: 'browse',
      emoji: '🗂️',
      category: 'periwinkle',
      title: t('manualTitle'),
      body: t('manualBody'),
    },
  ]
}

export function FirstRunState() {
  const t = useTranslations('dashboard.firstRun')
  const openCapture = useVoiceCapture((s) => s.openCapture)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase text-ink-muted">{t('title')}</h2>

      {routes(t).map((route) => {
        const content = (
          <>
            <EmojiChip emoji={route.emoji} category={route.category} size={40} />
            <span className="flex min-w-0 flex-1 flex-col text-start">
              <span className="truncate text-heading-sm text-ink">{route.title}</span>
              <span className="truncate text-body-sm text-ink-muted">{route.body}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-ink-subtle" />
          </>
        )
        const className =
          'flex w-full items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card transition-transform active:scale-[0.99]'

        if (route.key === 'speak') {
          return (
            <button key={route.key} type="button" onClick={openCapture} className={className}>
              {content}
            </button>
          )
        }
        return (
          <Link
            key={route.key}
            href={route.key === 'scan' ? '/documents' : '/matters'}
            className={className}
          >
            {content}
          </Link>
        )
      })}
    </section>
  )
}
