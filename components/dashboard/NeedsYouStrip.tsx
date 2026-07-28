'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

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
 */
export function NeedsYouStrip({
  needsInput = 0,
  scansAwaitingReview = 0,
  slipping = 0,
}: {
  needsInput?: number
  scansAwaitingReview?: number
  slipping?: number
}) {
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
      title: needsInput === 1 ? 'A guess to confirm' : 'A few guesses to confirm',
      body: 'I filed them already — correct me if I got one wrong.',
      href: '/uncertainties',
    })
  }

  if (scansAwaitingReview > 0) {
    items.push({
      key: 'scans',
      emoji: '📄',
      category: 'yellow',
      title: `${scansAwaitingReview} ${scansAwaitingReview === 1 ? 'scan' : 'scans'} to confirm`,
      body: 'Check what was pulled out before it lands.',
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
      // make someone stop opening the app.
      title: `${slipping} ${slipping === 1 ? 'matter has' : 'matters have'} slipped`,
      body: 'Sort them out when you have a moment.',
      href: '/matters',
    })
  }

  if (items.length === 0) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-label uppercase text-ink-muted">Needs you</h2>
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
