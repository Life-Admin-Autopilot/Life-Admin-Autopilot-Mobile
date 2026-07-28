// One consolidated card for ALL the held questions in a turn — instead of a
// stack of separate alerts. The assistant asks each held item in sequence inside a
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
//
// Answering resolves the PERSISTED Clarification through /me/clarifications/:id/
// resolve — the same endpoint /uncertainties uses. Before this, the deck only
// re-sent the answers as a fresh chat message and hoped the model re-derived a
// createTask from prose: the row stayed `open` forever while the UI said
// "Noted.", so every chat-answered question silently accumulated. The row id
// rides along on the tool RESULT (toolRunner returns `clarificationId`), which
// is persisted on the conversation, so it survives a reload.

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft } from 'lucide-react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'
import { useResolveClarification } from '@/queries/clarifications'
import type { AiToolCall } from '@/lib/ai/types'

interface ClarificationDeckProps {
  /** Every holdForClarification call from one assistant turn. */
  calls: AiToolCall[]
  /**
   * Fallback for holds with no persisted id (a failed tool call, or history
   * written before the deck resolved server-side): submit those answers as one
   * new turn so the item isn't lost.
   */
  onAnswer: (text: string) => void
  disabled?: boolean
}

const DOMAINS: readonly Domain[] = ['health', 'home', 'car', 'finance', 'family', 'pets']

function localTz(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

interface ParsedHold {
  callId: string
  /** The persisted Clarification row. Null → resolve via the chat fallback. */
  clarificationId: string | null
  question: string
  title: string
  domain: Domain | null
  /** Index is the position in the SERVER's options array — resolve sends it verbatim. */
  options: { label: string; index: number }[]
}

function parseHold(call: AiToolCall): ParsedHold {
  const args = call.args
  const rawOptions = Array.isArray(args.options) ? args.options : []
  const options = rawOptions
    .map((o, index) => ({
      label: o && typeof o === 'object' ? (o as Record<string, unknown>).label : null,
      index,
    }))
    .filter((o): o is { label: string; index: number } => typeof o.label === 'string' && o.label.trim().length > 0)
  const domain =
    typeof args.domain === 'string' && (DOMAINS as readonly string[]).includes(args.domain)
      ? (args.domain as Domain)
      : null
  const rawId = call.result?.clarificationId
  return {
    callId: call.callId,
    clarificationId: typeof rawId === 'string' && rawId.length > 0 ? rawId : null,
    question: typeof args.question === 'string' ? args.question : 'One item needs your input.',
    title: typeof args.title === 'string' ? args.title : '',
    domain,
    options,
  }
}

/** What the user picked. `optionIndex` null → they typed it themselves. */
interface DeckAnswer {
  label: string
  optionIndex: number | null
}

export function ClarificationDeck({ calls, onAnswer, disabled = false }: ClarificationDeckProps) {
  const holds = useMemo(() => calls.map(parseHold), [calls])
  const total = holds.length
  const resolve = useResolveClarification()

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, DeckAnswer>>({})
  const [text, setText] = useState('')
  const [typing, setTyping] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const current = holds[index]
  const hasOptions = (current?.options.length ?? 0) > 0
  const storedAnswer = current ? (answers[current.callId]?.label ?? '') : ''
  // Will committing the current answer resolve the LAST open question?
  const completesDeck =
    holds.filter((h) => h.callId !== current?.callId && !(h.callId in answers)).length === 0

  const submit = (finalAnswers: Record<string, DeckAnswer>) => {
    if (submitted) return
    setSubmitted(true)
    // Rows that resolved server-side are already filed. Re-sending them as prose
    // would make the model create a SECOND task for the same item, so only holds
    // with no persisted id take the chat fallback.
    const legacy = holds.filter((h) => !h.clarificationId)
    if (legacy.length === 0) return
    // The held questions aren't replayed into the agent's context, so the reply
    // must be self-contained: pair each matter's title with its answer.
    const lines = legacy.map((h) => `${h.title || 'Item'} → ${finalAnswers[h.callId]?.label ?? ''}`)
    const combined =
      legacy.length === 1 ? lines[0] ?? '' : `Answers to your held questions:\n${lines.join('\n')}`
    onAnswer(combined)
  }

  const commit = (value: string, optionIndex: number | null = null) => {
    const v = value.trim()
    if (!v || !current || disabled || submitted) return
    const next = { ...answers, [current.callId]: { label: v, optionIndex } }
    setAnswers(next)
    setTyping(false)

    // Close the persisted row now, one request per item — a single failed
    // resolve can't strand the rest of the deck.
    if (current.clarificationId) {
      resolve.mutate({
        id: current.clarificationId,
        answer:
          optionIndex !== null ? { type: 'option', index: optionIndex } : { type: 'custom', text: v },
        timezone: localTz(),
      })
    }

    if (Object.keys(next).length === total) {
      submit(next)
      return
    }
    // Advance to the first still-open question.
    const nextIdx = holds.findIndex((h) => !(h.callId in next))
    setIndex(nextIdx)
    setText(next[holds[nextIdx]?.callId ?? '']?.label ?? '')
  }

  const goBack = () => {
    if (index === 0 || disabled || submitted) return
    const i = index - 1
    setIndex(i)
    setText(answers[holds[i]?.callId ?? '']?.label ?? '')
    setTyping(false)
  }

  // All answered (or submitted) → a quiet confirmation row.
  if (!current || submitted) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-field px-3 py-2">
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
      className="flex w-full flex-col gap-3 overflow-hidden rounded-2xl bg-surface p-4 shadow-card"
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
              {current.options.map(({ label, index: optionIndex }) => (
                <button
                  key={`${current.callId}-${label}-${optionIndex}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => commit(label, optionIndex)}
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
              className="h-10 min-w-0 rounded-xl bg-surface-field px-3.5 text-body-sm text-ink outline-none placeholder:text-ink-muted"
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
