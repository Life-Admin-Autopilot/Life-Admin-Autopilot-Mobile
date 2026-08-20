'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'

interface NeedsYouItem {
  key: string
  emoji: string
  category: CatColor
  title: string
  body: string
  href: string
}

/**
 * The three inboxes that hold work the app cannot finish without the user, in
 * one strip: questions the AI is holding, scans waiting to be confirmed, and
 * matters that have slipped.
 *
 * Before this, uncertainties had a banner and the other two were invisible from
 * home — a document could sit in `ready_for_review` indefinitely because nothing
 * on the screen the user actually opens ever mentioned it.
 *
 * Ordered by how cheap the item is to clear, not by how loud it is. Answering a
 * held question takes seconds; sorting out a slipped matter takes a decision.
 * Leading with the cheap one means the strip usually gets shorter when tapped.
 *
 * While the counts are still in flight this renders a placeholder row rather
 * than nothing. Returning null was doing two bad things at once: it asserted
 * "nothing needs you" before that was known, and because the section occupied no
 * space, the real rows shoved the page down when they arrived. Skeletons are the
 * standard answer to both — they hold the space and they communicate progress
 * instead of a false all-clear.
 */
export function NeedsYouStrip({
  needsInput = 0,
  scansAwaitingReview = 0,
  slipping = 0,
  loaded = true,
}: {
  needsInput?: number
  scansAwaitingReview?: number
  slipping?: number
  /** False while the counts are still loading — renders placeholders. */
  loaded?: boolean
}) {
  const t = useTranslations('dashboard.needsYou')

  if (!loaded) return <NeedsYouSkeleton />

  const items: NeedsYouItem[] = []

  if (needsInput > 0) {
    items.push({
      key: 'input',
      emoji: '💭',
      category: 'blush',
      // Deliberately UNCOUNTED. These items are already filed as tasks with a
      // guess applied — nothing is waiting on the user, so a running tally
      // would be inventing an obligation that doesn't exist. A number here is
      // the thing that turns an optional tidy-up into a debt to clear, which
      // for this audience is what makes an app stop being opened at all.
      //
      // Still an ICU plural, with no `#` in any of its bodies. `n === 1 ? … : …`
      // is a two-way English test, and Arabic selects across six categories —
      // the branch that reads "a few" has to be able to say "افتراضان" for two.
      // The plural picks the wording; it is the `#` that would print the tally,
      // and there deliberately isn't one.
      title: t('guesses', { count: needsInput }),
      body: t('guessesBody'),
      href: '/uncertainties',
    })
  }

  if (scansAwaitingReview > 0) {
    items.push({
      key: 'scans',
      emoji: '📄',
      category: 'yellow',
      title: t('scans', { count: scansAwaitingReview }),
      body: t('scansBody'),
      href: '/documents',
    })
  }

  if (slipping > 0) {
    items.push({
      key: 'slipping',
      emoji: '🌾',
      category: 'peach',
      // "Have slipped", never "overdue". The tint and the wording both stay
      // warm on purpose: a red count here is the single most reliable way to
      // make someone stop opening the app. The Arabic follows the same rule —
      // "تأخّر", not "متأخر" as a verdict.
      title: t('slipped', { count: slipping }),
      body: t('slippedBody'),
      // Lands on the slipped matters themselves, not the whole list. A row that
      // says "1 matter has slipped" and then opens ninety of them has told the
      // user something and then hidden it.
      href: '/matters?filter=slipping',
    })
  }

  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase text-ink-muted">{t('title')}</h2>

      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
        >
          <EmojiChip emoji={item.emoji} category={item.category} size={40} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-heading-sm text-ink">{item.title}</span>
            <span className="truncate text-body-sm text-ink-muted">{item.body}</span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-ink-subtle" />
        </Link>
      ))}
    </section>
  )
}

// One placeholder row. Deliberately ONE, not three: the strip is usually short
// or absent, and reserving three rows to collapse to nothing would trade the
// shift we are removing for a bigger one in the other direction. Its height
// matches a real row so the common cases (one row, or none) settle without
// moving the page.
function NeedsYouSkeleton() {
  const t = useTranslations('dashboard.needsYou')

  return (
    <section className="flex flex-col gap-3" aria-hidden>
      <h2 className="text-label uppercase text-ink-muted">{t('title')}</h2>
      <div className="h-[68px] animate-pulse rounded-2xl bg-surface-sunken" />
    </section>
  )
}
