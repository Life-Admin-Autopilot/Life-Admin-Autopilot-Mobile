'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { AlertTriangle, HelpCircle } from 'lucide-react'

/**
 * A question that arrived while the app was open — rendered as a small square
 * panel at the top of the screen, not a passing toast line.
 *
 * The passing line was tried first and it under-serves this moment: "1 needs
 * your input" is a STATEMENT, and what the worker actually produced is a
 * DECISION — this matter clashes with that one; reschedule it or keep it? A
 * decision gets a surface with the two answers on it, differently weighted, so
 * taking either costs one tap and ignoring it costs nothing.
 *
 * Deliberately dumb about WHAT the buttons do — deep-link to the matter, drop a
 * clarification, open the stack — because this same square asks both clash
 * questions ("reschedule?") and plain ones ("answer now?").
 *
 * It is NOT dumb about its own lifetime, and that is deliberate too. Sonner's
 * dismiss timer pauses while the pointer is over the toaster; a CSS countdown
 * does not. Handing the duration to both produced a bar that drained to empty
 * and a panel that then sat there — the exact "it says it is leaving and it
 * never leaves" the bar was added to prevent. So one clock runs both: this
 * component times itself, pauses on hover, and pauses the bar with it. The
 * caller passes `duration` + `onExpire` and hands sonner `Infinity`.
 */
export function DecisionToast({
  tone,
  title,
  description,
  primary,
  secondary,
  duration,
  onExpire,
}: {
  tone: 'clash' | 'question'
  title: string
  description?: string
  primary: { label: string; onPress: () => void }
  secondary: { label: string; onPress: () => void }
  /** Milliseconds to live. Omit for a panel that waits to be answered. */
  duration?: number
  /** Called once the time is up. Omit and the timer never runs. */
  onExpire?: () => void
}) {
  const Icon = tone === 'clash' ? AlertTriangle : HelpCircle
  // Honoured by drawing the bar STATIC, not by dropping it: someone who asked
  // for less motion still needs to know the panel is on a clock.
  const reduced = useReducedMotion()

  const [paused, setPaused] = useState(false)
  // What is left when the pointer arrives, so a hover does not restart the
  // countdown from full — that would let a panel be held open forever by a
  // cursor that merely happens to rest there.
  const remainingRef = useRef<number | null>(null)

  useEffect(() => {
    if (!duration || !onExpire || paused) return

    const remaining = remainingRef.current ?? duration
    const startedAt = Date.now()
    const timer = setTimeout(onExpire, remaining)

    return () => {
      clearTimeout(timer)
      remainingRef.current = Math.max(0, remaining - (Date.now() - startedAt))
    }
  }, [duration, onExpire, paused])

  return (
    // `overflow-hidden` so the countdown's square ends are clipped by the card's
    // radius rather than poking out of the corners.
    <div
      className="w-full max-w-90 overflow-hidden rounded-2xl bg-surface shadow-elevated"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <Icon
            size={16}
            className={`mt-0.5 shrink-0 ${tone === 'clash' ? 'text-warning' : 'text-accent'}`}
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-body-sm font-medium text-ink" dir="auto">
              {title}
            </span>
            {description ? (
              <span className="mt-0.5 text-caption text-ink-muted" dir="auto">
                {description}
              </span>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {/* The reschedule is the accent action, the keep is the warning one —
              the colours carry the same meaning the matters sheet gives them. */}
          <button
            type="button"
            onClick={primary.onPress}
            className="flex-1 rounded-pill bg-accent px-3 py-1.5 text-caption font-medium text-accent-ink"
          >
            {primary.label}
          </button>
          <button
            type="button"
            onClick={secondary.onPress}
            className={`flex-1 rounded-pill px-3 py-1.5 text-caption font-medium ${
              tone === 'clash' ? 'bg-warning text-accent-ink' : 'bg-surface-field text-ink-muted'
            }`}
          >
            {secondary.label}
          </button>
        </div>
      </div>

      {/* Beneath everything and full-bleed: a hairline the eye can read without
          looking at, rather than a widget competing with the two buttons. */}
      {duration ? (
        <div className="h-0.5 w-full bg-surface-field" aria-hidden>
          <div
            className={`h-full origin-left rtl:origin-right ${
              tone === 'clash' ? 'bg-warning' : 'bg-accent'
            } ${reduced ? '' : 'animate-decision-countdown'}`}
            style={
              reduced
                ? undefined
                : {
                    animationDuration: `${duration}ms`,
                    animationPlayState: paused ? 'paused' : 'running',
                  }
            }
          />
        </div>
      ) : null}
    </div>
  )
}
