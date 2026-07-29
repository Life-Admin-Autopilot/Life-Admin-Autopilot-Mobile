'use client'

import { useEffect, useRef } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmojiChip } from '@/components/ui/EmojiChip'
import { Pill } from '@/components/ui/Pill'
import { cn } from '@/lib/cn'
import type { OnboardingStep } from '@/lib/onboarding/questions'

export type MeasureFn = (stepId: string, height: number) => void

/**
 * The card body that lives inside the morphing island.
 *
 * It is INTRINSICALLY sized — never `h-full`, never `mt-auto`. The shell is a
 * fixed-height animated box, so a pane that takes its height FROM the shell
 * silently overflows the moment the copy outgrows the number in the step config
 * (which is how Continue ended up welded to the name field). Here the pane owns
 * its own vertical rhythm and reports the height back up; the shell morphs to
 * fit. Copy can grow without anyone editing a magic number.
 */
export function OnboardingCard({
  stepId,
  onMeasure,
  className,
  children,
}: {
  stepId: string
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
    // in the middle of AnimatePresence's exit→enter handoff, which drops the
    // incoming pane's fade-in and leaves the card blank.
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height
      onMeasure(stepId, Math.ceil(height))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [stepId, onMeasure])

  return (
    <div ref={ref} className={cn('flex flex-col px-6 pt-5 pb-6', className)}>
      {children}
    </div>
  )
}

/**
 * Step glyph + label pill on the left, back affordance on the right, then the
 * question. Back sits at the right edge deliberately: it comes and goes between
 * steps, and anything it shares a left edge with would hop sideways with it.
 * Right-anchored, it can appear on step two without nudging the label out of
 * alignment with the heading below.
 */
export function StepHeader({
  step,
  canBack,
  onBack,
}: {
  step: OnboardingStep
  canBack: boolean
  onBack: () => void
}) {
  return (
    <header className="flex flex-col">
      <div className="flex h-8 items-center gap-2.5">
        <EmojiChip emoji={step.emoji} category={step.category} size={30} />
        <Pill tone="accent" uppercase>
          Onboarding
        </Pill>
        {canBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="ms-auto grid size-8 shrink-0 place-items-center rounded-full text-ink-subtle outline-none transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <ArrowLeft size={17} />
          </button>
        ) : null}
      </div>

      <h2 id={headingId(step.id)} className="mt-3 text-pretty font-display text-heading-serif text-ink">
        {step.question}
      </h2>
      {step.hint ? <p className="mt-1 text-body-sm text-ink-muted">{step.hint}</p> : null}
    </header>
  )
}

export const headingId = (stepId: string) => `onboarding-${stepId}-question`

/**
 * The step CTA. Near-black pill per the design system, but with a DESIGNED
 * disabled state: the stock `disabled:opacity-50` turns near-black into a dead
 * grey slab that reads as broken rather than as "not yet".
 *
 * Disabled is an OUTLINE, not a fill — a filled disabled pill sitting under a
 * filled taupe input gives two near-identical stacked shapes and no hierarchy.
 * Hollow reads as "locked", and the flip to near-black when the field is valid
 * feels like the step unlocking.
 */
export function OnboardingCta({
  children,
  disabled,
  onClick,
  className,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      variant="solid"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'w-full disabled:border-border-strong disabled:bg-transparent disabled:text-ink-subtle disabled:opacity-100',
        className,
      )}
    >
      {children}
      <ArrowRight className="transition-transform duration-200 group-hover/button:translate-x-0.5" />
    </Button>
  )
}
