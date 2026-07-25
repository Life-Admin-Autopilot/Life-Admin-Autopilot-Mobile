// One consolidated card for ALL the held questions in a turn — instead of a
// stack of separate alerts. The panda asks each held item in sequence inside a
// single surface (with a "1 of N" counter and Back/Next). Once every question
// is answered the deck submits ONE combined reply, so the agent files all the
// held matters in a single turn.
//
// Transitions between questions reuse the Dynamic Island morph: the outgoing
// question fades out (pure opacity), the shell springs to the new height, then
// the incoming question fades in — MORPH_CONTENT_VARIANTS + a layout spring,
// the same physics as the island shell (see lib/motion.ts).
//
// A single held item degrades to a plain one-question card (no counter / Back).

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'
import type { AiToolCall } from '@/lib/ai/types'

interface ClarificationDeckProps {
  /** Every holdForClarification call from one assistant turn. */
  calls: AiToolCall[]
  /** Submit the combined answers as a single new turn. */
  onAnswer: (text: string) => void
  disabled?: boolean
}

const DOMAINS: readonly Domain[] = ['health', 'home', 'car', 'finance', 'family', 'pets']

interface ParsedHold {
  callId: string
  question: string
  title: string
  domain: Domain | null
  options: string[]
}

function parseHold(call: AiToolCall): ParsedHold {
  const args = call.args
  const rawOptions = Array.isArray(args.options) ? args.options : []
  const options = rawOptions
    .map((o) => (o && typeof o === 'object' ? (o as Record<string, unknown>).label : null))
    .filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
  const domain =
    typeof args.domain === 'string' && (DOMAINS as readonly string[]).includes(args.domain)
      ? (args.domain as Domain)
      : null
  return {
    callId: call.callId,
    question: typeof args.question === 'string' ? args.question : 'One item needs your input.',
    title: typeof args.title === 'string' ? args.title : '',
    domain,
    options,
  }
}

export function ClarificationDeck({ calls, onAnswer, disabled = false }: ClarificationDeckProps) {
  const holds = useMemo(() => calls.map(parseHold), [calls])
  const total = holds.length

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const current = holds[index]
  const hasOptions = (current?.options.length ?? 0) > 0
  const storedAnswer = current ? (answers[current.callId] ?? '') : ''
  // Will committing the current answer resolve the LAST open question?
  const completesDeck =
    holds.filter((h) => h.callId !== current?.callId && !(h.callId in answers)).length === 0

  const submit = (finalAnswers: Record<string, string>) => {
    if (submitted) return
    setSubmitted(true)
    // The held questions aren't replayed into the agent's context, so the reply
    // must be self-contained: pair each matter's title with its answer.
    const lines = holds.map((h) => `${h.title || 'Item'} → ${finalAnswers[h.callId] ?? ''}`)
    const combined =
      holds.length === 1 ? lines[0] ?? '' : `Answers to your held questions:\n${lines.join('\n')}`
    onAnswer(combined)
  }

  const commit = (value: string) => {
    const v = value.trim()
    if (!v || !current || disabled || submitted) return
    const next = { ...answers, [current.callId]: v }
    setAnswers(next)
    setTyping(false)
    if (Object.keys(next).length === total) {
      submit(next)
      return
    }
    // Advance to the first still-open question.
    const nextIdx = holds.findIndex((h) => !(h.callId in next))
    setIndex(nextIdx)
    setText(next[holds[nextIdx]?.callId ?? ''] ?? '')
  }

  const goBack = () => {
    if (index === 0 || disabled || submitted) return
    const i = index - 1
    setIndex(i)
    setText(answers[holds[i]?.callId ?? ''] ?? '')
    setTyping(false)
  }

  // All answered (or submitted) → a quiet confirmation row.
  if (!current || submitted) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <span className="text-caption font-medium text-ink">
          {total === 1 ? 'Noted.' : `Filing ${total} matters…`}
        </span>
      </div>
    )
  }

  const pending = text.trim() ? text.trim() : storedAnswer
  const primaryLabel = completesDeck ? 'File all' : 'Next'
  const showInput = typing || !hasOptions

  return (
    <motion.div
      layout
      transition={MORPH_SPRING}
      style={{ transformOrigin: 'top left' }}
      className="flex w-full flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface p-3.5 shadow-card"
    >
      {/* Progress — only with more than one question. */}
      {total > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-caption font-medium text-ink-subtle">
            Question {index + 1} of {total}
          </span>
          <div className="flex gap-1" aria-hidden>
            {holds.map((h, i) => (
              <span
                key={h.callId}
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors',
                  h.callId in answers ? 'bg-accent' : i === index ? 'bg-ink-muted' : 'bg-border',
                )}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* The morphing question body — fade out / spring height / fade in. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={current.callId}
          variants={MORPH_CONTENT_VARIANTS}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            {current.domain ? (
              <DomainIcon domain={current.domain} size={24} className="rounded-full" />
            ) : null}
            {current.title ? <p className="text-caption text-ink-muted">{current.title}</p> : null}
            <p className="text-body-sm font-semibold text-ink" dir="auto">
              {current.question}
            </p>
          </div>

          {hasOptions ? (
            <div className="flex flex-wrap gap-2">
              {current.options.map((label, i) => (
                <button
                  key={`${current.callId}-${label}-${i}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => commit(label)}
                  className={cn(
                    'rounded-pill border px-3 py-1.5 text-caption transition-colors disabled:opacity-50',
                    storedAnswer === label
                      ? 'border-accent bg-accent/10 text-ink'
                      : 'border-border bg-surface text-ink hover:bg-surface-sunken',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          {showInput ? (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(text)
              }}
              placeholder="Type a reply…"
              autoFocus={!hasOptions}
              disabled={disabled}
              dir="auto"
              className="h-9 min-w-0 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
            />
          ) : !storedAnswer ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTyping(true)}
              className={cn('self-start text-caption text-ink-subtle hover:text-ink', disabled && 'opacity-50')}
            >
              Type a reply
            </button>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* Persistent controls — Back stays put while questions morph past it. */}
      <div className="flex items-center justify-between gap-2">
        {index > 0 ? (
          <button
            type="button"
            disabled={disabled}
            onClick={goBack}
            className="flex items-center gap-1 text-caption text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
          >
            <ChevronLeft size={14} />
            Back
          </button>
        ) : (
          <span />
        )}

        <Button
          variant="default"
          size="sm"
          className="shrink-0"
          disabled={disabled || pending.length === 0}
          onClick={() => commit(pending)}
        >
          {primaryLabel}
        </Button>
      </div>
    </motion.div>
  )
}
