'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

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

const ROUTES: StartRoute[] = [
  {
    key: 'speak',
    emoji: '🎙️',
    category: 'blush',
    title: 'Say what’s on your mind',
    body: '“The car insurance is up next month.”',
  },
  {
    key: 'scan',
    emoji: '📄',
    category: 'yellow',
    title: 'Scan a bill or letter',
    body: 'I’ll pull out the dates and amounts.',
  },
  {
    key: 'browse',
    emoji: '🗂️',
    category: 'periwinkle',
    title: 'Add one by hand',
    body: 'Anything you already know is coming.',
  },
]

export function FirstRunState() {
  const openCapture = useVoiceCapture((s) => s.openCapture)

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase text-ink-muted">Start anywhere</h2>

      {ROUTES.map((route) => {
        const content = (
          <>
            <EmojiChip emoji={route.emoji} category={route.category} size={40} />
            <span className="flex min-w-0 flex-1 flex-col text-left">
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
