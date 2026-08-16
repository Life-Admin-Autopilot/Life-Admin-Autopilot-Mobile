'use client'

// The gap between "sent" and the first token.
//
// Three dots alone say the app is alive; they do not say for how much longer,
// and they read identically at 300ms and at eight seconds. A turn that files
// three matters spends that whole time in tool calls with nothing to stream, so
// the dots were the entire feedback for the slowest turns the product has.
//
// Staged, so a fast turn never flashes a label nobody had time to read:
//   0–2.5s        dots only
//   2.5s+         + "Thinking…"
//   tool_call in  + "Working on it…" — the model is no longer deciding what to
//                   do, it is doing it, and the label should stop claiming
//                   otherwise.
//
// Opacity only, and both the dots and the label go still under
// prefers-reduced-motion — the text carries the state on its own there.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

/** How long the stream may stay silent before it owes the user a word. */
const QUIET_MS = 2500

interface StreamingStatusProps {
  /** Has a tool call landed in this turn yet? */
  working: boolean
}

export function StreamingStatus({ working }: StreamingStatusProps) {
  const t = useTranslations('chat')
  const [quiet, setQuiet] = useState(false)

  // Mount-once: this component only exists while the turn has produced no text,
  // so its lifetime IS the quiet window — the first token unmounts it.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuiet(true), QUIET_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="flex items-center gap-2 py-1" aria-live="polite">
      <StreamingDots />
      {quiet ? (
        <span className="text-caption text-ink-subtle animate-in fade-in duration-300 motion-reduce:animate-none">
          {working ? t('streaming.working') : t('streaming.thinking')}
        </span>
      ) : null}
    </div>
  )
}

// Three-dot indicator for the moment between request send and first token.
export function StreamingDots() {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:0ms] motion-reduce:animate-none" />
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:150ms] motion-reduce:animate-none" />
      <span className="size-1.5 animate-pulse rounded-full bg-ink-subtle [animation-delay:300ms] motion-reduce:animate-none" />
    </div>
  )
}
