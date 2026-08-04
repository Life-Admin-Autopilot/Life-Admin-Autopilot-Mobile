'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'

export type MeasureFn = (state: string, height: number) => void

/**
 * The card body inside the morphing shell.
 *
 * INTRINSICALLY sized — never `h-full`, never `mt-auto`. The shell is a
 * fixed-height animated box, so a pane that takes its height FROM the shell
 * overflows the moment the content outgrows the number the shell was given.
 * That number used to be arithmetic (`262 + options * 52`), which assumed a
 * one-line question: the two-line ones pushed Skip/Drop past the clipped edge,
 * and Arabic — longer nearly everywhere — was a step worse. The pane owns its
 * own vertical rhythm and reports its height back up; the shell springs to fit.
 *
 * Same contract as OnboardingCard, deliberately: two morphing card stacks with
 * two different sizing rules is how one of them silently rots.
 */
export function UncertaintyCard({
  state,
  onMeasure,
  className,
  children,
}: {
  /** The shape key this height belongs to — a clarification id, or 'done'. */
  state: string
  onMeasure: MeasureFn
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // A ResizeObserver always fires once on observe, so the first measurement
    // comes for free — and it arrives in its own task, clear of React's commit.
    // Reporting synchronously from a layout effect instead re-renders the tree
    // mid-AnimatePresence handoff, which drops the incoming pane's fade-in.
    const observer = new ResizeObserver(([entry]) => {
      const height =
        entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
      onMeasure(state, Math.ceil(height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [state, onMeasure])

  return (
    <div ref={ref} className={cn('flex flex-col p-6', className)}>
      {children}
    </div>
  )
}

/**
 * The request that produced this question, in the user's own words.
 *
 * The card can be answered days after the asking, on a screen that carries none
 * of the conversation around it. Without this it showed only Kitto's paraphrase
 * ("Email that guy") above its own question ("What's the email to that guy
 * about?") — two restatements of a request the user could no longer see, which
 * is a memory test rather than a question.
 *
 * Clamped to three lines: one voice note can hold six matters, and every
 * question from it quotes the same transcript. Three lines is enough to
 * recognise a moment; it is not meant to be the whole recording.
 *
 * `dir="auto"` because this is the ONE string on the card that is neither ours
 * nor translated — an Arabic sentence must lay out right-to-left inside an
 * English interface, and vice versa.
 */
export function OriginalRequest({ text }: { text: string }) {
  const t = useTranslations('uncertainty')

  return (
    <figure className="mt-3 rounded-2xl bg-surface-sunken px-3.5 py-2.5">
      <figcaption className="text-caption font-medium text-ink-subtle">{t('youSaid')}</figcaption>
      <blockquote dir="auto" className="mt-0.5 line-clamp-3 text-body-sm text-ink">
        {text}
      </blockquote>
    </figure>
  )
}
