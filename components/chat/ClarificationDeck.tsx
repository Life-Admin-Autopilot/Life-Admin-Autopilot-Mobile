'use client'

// ONE card holding EVERY question the assistant raised in a turn, all of them
// visible at once.
//
// This was a deck: "Question 1 of 3", Back/Next, one question on screen at a
// time. Two things were wrong with that. The user could not see how much they
// were being asked for before starting, and each answer committed on its own —
// so the card was a queue to be walked rather than a form to be filled. Chat is
// not allowed to drip-feed questions; every matter is already filed, and the
// asks for one turn belong in one place with one Save.
//
// What survives from the deck, unchanged, because it was correct:
//   - the parse (lib/ai/clarificationHolds.ts) and the option INDEX contract —
//     resolve sends the SERVER's index verbatim,
//   - one resolve REQUEST PER ROW, so a single failed answer cannot strand the
//     rest of the card,
//   - the legacy fallback: holds with no persisted id (a failed tool call, or
//     history written before the deck resolved server-side) go back through the
//     chat as one combined prose reply so the item is not lost,
//   - the rule that rows which DID resolve server-side are never re-sent as
//     prose — the model would file a second task for the same matter.
//
// Partial answers are the expected case, not an error: Save resolves what has
// been answered, the rest stay open here and in /uncertainties.
//
// No framer-motion: with every question on screen there is nothing to morph
// between, and the sanctioned surfaces for it are the island primitives.

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import { ClarificationRow } from '@/components/chat/ClarificationRow'
import { Button } from '@/components/ui/button'
import {
  localTimezone,
  parseHolds,
  type HoldAnswer,
  type HoldOption,
  type ParsedHold,
} from '@/lib/ai/clarificationHolds'
import { useResolveClarification } from '@/queries/clarifications'
import type { AiToolCall } from '@/lib/ai/types'

interface ClarificationDeckProps {
  /** Every holdForClarification call from one assistant turn. */
  calls: AiToolCall[]
  /** The legacy path: holds with no persisted id answer as a new chat turn. */
  onAnswer: (text: string) => void
  disabled?: boolean
}

export function ClarificationDeck({ calls, onAnswer, disabled = false }: ClarificationDeckProps) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  const holds = useMemo(() => parseHolds(calls), [calls])
  const resolve = useResolveClarification()

  const [picked, setPicked] = useState<Record<string, HoldOption>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  /** Rows already resolved by an earlier Save on this card. */
  const [saved, setSaved] = useState<Record<string, HoldAnswer>>({})

  // A row's answer is whichever affordance it used last: picking an option
  // clears the typed draft and typing clears the pick, so the two can never
  // disagree about what Save is about to send.
  const answerFor = (hold: ParsedHold): HoldAnswer | null => {
    const done = saved[hold.callId]
    if (done) return done
    const option = picked[hold.callId]
    if (option) return { label: option.label, optionIndex: option.index }
    const text = (drafts[hold.callId] ?? '').trim()
    return text ? { label: text, optionIndex: null } : null
  }

  const pick = (hold: ParsedHold, option: HoldOption) => {
    setPicked((prev) => ({ ...prev, [hold.callId]: option }))
    setDrafts((prev) => ({ ...prev, [hold.callId]: '' }))
  }

  const draft = (hold: ParsedHold, value: string) => {
    setDrafts((prev) => ({ ...prev, [hold.callId]: value }))
    if (value.trim().length === 0) return
    setPicked((prev) => {
      if (!(hold.callId in prev)) return prev
      const next = { ...prev }
      delete next[hold.callId]
      return next
    })
  }

  const unsaved = holds.filter((hold) => !saved[hold.callId])
  const stagedRows = unsaved.filter((hold) => answerFor(hold) !== null)
  const openRows = unsaved.length - stagedRows.length

  const save = () => {
    if (disabled || stagedRows.length === 0) return

    const committed: Record<string, HoldAnswer> = {}
    // Holds the server never persisted. Their answers ride back through the
    // chat instead, as ONE message — the questions are not replayed into the
    // model's context, so each line has to name its own matter.
    const legacy: string[] = []

    for (const hold of stagedRows) {
      const answer = answerFor(hold)
      if (!answer) continue
      committed[hold.callId] = answer

      if (hold.clarificationId) {
        resolve.mutate({
          id: hold.clarificationId,
          answer:
            answer.optionIndex !== null
              ? { type: 'option', index: answer.optionIndex }
              : { type: 'custom', text: answer.label },
          timezone: localTimezone(),
        })
      } else {
        legacy.push(hold.title ? `${hold.title} → ${answer.label}` : answer.label)
      }
    }

    setSaved((prev) => ({ ...prev, ...committed }))
    if (legacy.length === 1) onAnswer(legacy[0] ?? '')
    else if (legacy.length > 1) onAnswer(`${t('clarify.answersPrefix')}\n${legacy.join('\n')}`)
  }

  // Everything answered → the card collapses to a receipt. Past tense, and about
  // the CORRECTION rather than the filing: the matters were filed when the
  // questions were raised, so anything in the future tense here describes work
  // that finished before the user read it.
  if (holds.length > 0 && unsaved.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-surface-field px-3 py-2">
        <span className="text-caption font-medium text-ink">
          {t('clarify.saved', { count: holds.length })}
        </span>
      </div>
    )
  }

  if (holds.length === 0) return null

  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card">
      {holds.length > 1 ? (
        <span className="text-label uppercase text-ink-subtle">
          {t('clarify.heading', { count: holds.length })}
        </span>
      ) : null}

      {/* Every question at once. The divider is the only separation they get —
          a card per question inside a card is the box-in-a-box the chat
          transcript already suffers from. */}
      <ul className="flex flex-col [&>li:not(:first-child)]:mt-3.5 [&>li:not(:first-child)]:border-t [&>li:not(:first-child)]:border-border/60 [&>li:not(:first-child)]:pt-3.5">
        {holds.map((hold) => (
          <ClarificationRow
            key={hold.callId}
            hold={hold}
            answer={answerFor(hold)}
            draft={drafts[hold.callId] ?? ''}
            typing={Boolean(typing[hold.callId])}
            saved={Boolean(saved[hold.callId])}
            disabled={disabled}
            onPick={(option) => pick(hold, option)}
            onDraft={(value) => draft(hold, value)}
            onReveal={() => setTyping((prev) => ({ ...prev, [hold.callId]: true }))}
            onSubmit={save}
          />
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3">
        {/* The one line that makes a partial answer safe to give: nothing is
            lost by leaving a question alone. */}
        <span className="text-caption text-ink-subtle">
          {openRows > 0 ? t('clarify.queueNote') : null}
        </span>
        <Button
          variant="solid"
          size="sm"
          className="shrink-0"
          disabled={disabled || stagedRows.length === 0}
          onClick={save}
        >
          {tCommon('save')}
        </Button>
      </div>
    </div>
  )
}
