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
// A single hold can now raise SEVERAL questions about ONE matter, so the card is
// grouped by matter rather than by question: the facts block once, then every
// question about it stacked underneath (ClarificationMatter). Questions about
// different matters keep their own facts block and the divider between them.
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

import { ClarificationMatter } from '@/components/chat/ClarificationMatter'
import type { ClarificationRowState } from '@/components/chat/ClarificationRow'
import { Button } from '@/components/ui/button'
import {
  groupHolds,
  isAnswerable,
  localTimezone,
  parseHolds,
  resolvedMatterFrom,
  type HoldAnswer,
  type HoldOption,
  type ParsedHold,
  type ResolvedMatter,
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

/** One line of the prose fallback. Each names its own matter, and its own
 *  question when the matter was asked more than one thing — the questions are
 *  not replayed into the model's context, so "Dentist → 6pm" twice would be two
 *  answers to the same ask. */
function legacyLine(hold: ParsedHold, answer: HoldAnswer, multi: boolean): string {
  const stem = [hold.title, multi ? hold.question : ''].filter(Boolean).join(' — ')
  return stem ? `${stem} → ${answer.label}` : answer.label
}

export function ClarificationDeck({ calls, onAnswer, disabled = false }: ClarificationDeckProps) {
  const t = useTranslations('chat')
  const tCommon = useTranslations('common')
  const holds = useMemo(() => parseHolds(calls), [calls])
  const groups = useMemo(() => groupHolds(holds), [holds])
  const resolve = useResolveClarification()

  const [picked, setPicked] = useState<Record<string, HoldOption>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [typing, setTyping] = useState<Record<string, boolean>>({})
  /** Rows already resolved by an earlier Save on this card. */
  const [saved, setSaved] = useState<Record<string, HoldAnswer>>({})
  /**
   * Each matter as the server left it — the confirmed date, the title an answer
   * rewrote, and whether it will now fire. Keyed by MATTER, not by question:
   * answering the time question redraws the same facts block the "which friend"
   * question hangs off. Without this the block would keep rendering the guess it
   * just asked the user to correct.
   */
  const [resolved, setResolved] = useState<Record<string, ResolvedMatter>>({})

  // A row's answer is whichever affordance it used last: picking an option
  // clears the typed draft and typing clears the pick, so the two can never
  // disagree about what Save is about to send.
  const answerFor = (hold: ParsedHold): HoldAnswer | null => {
    const done = saved[hold.rowKey]
    if (done) return done
    const option = picked[hold.rowKey]
    if (option) return { label: option.label, optionIndex: option.index }
    const text = (drafts[hold.rowKey] ?? '').trim()
    return text ? { label: text, optionIndex: null } : null
  }

  const stateOf = (hold: ParsedHold): ClarificationRowState => ({
    answer: answerFor(hold),
    draft: drafts[hold.rowKey] ?? '',
    typing: Boolean(typing[hold.rowKey]),
    saved: Boolean(saved[hold.rowKey]),
  })

  const pick = (hold: ParsedHold, option: HoldOption) => {
    setPicked((prev) => ({ ...prev, [hold.rowKey]: option }))
    setDrafts((prev) => ({ ...prev, [hold.rowKey]: '' }))
  }

  const draft = (hold: ParsedHold, value: string) => {
    setDrafts((prev) => ({ ...prev, [hold.rowKey]: value }))
    if (value.trim().length === 0) return
    setPicked((prev) => {
      if (!(hold.rowKey in prev)) return prev
      const next = { ...prev }
      delete next[hold.rowKey]
      return next
    })
  }

  // EVERY count and every control below is over the ANSWERABLE rows only. An
  // inert row can never be saved, so counting it would leave `settled`
  // permanently false — the Save footer and the queue note would outlive the
  // last real question, and the card would promise the queue is holding
  // something that was never written to it.
  const answerable = holds.filter(isAnswerable)
  const answerableGroups = groups.filter((group) => group.rows.some(isAnswerable))
  const unsaved = answerable.filter((hold) => !saved[hold.rowKey])
  const stagedRows = unsaved.filter((hold) => answerFor(hold) !== null)
  const openRows = unsaved.length - stagedRows.length

  /**
   * Answer one matter's questions, in the order they were asked.
   *
   * Sequential for the READ, not the write: resolve patches only the fields the
   * tapped option carries, so two siblings in flight cannot lose each other's
   * changes server-side. But each reply describes the task as it stood when
   * THAT request was served, and the facts block redraws from whichever reply
   * lands last — so answering in parallel could put the confirmed date back to
   * the guess it replaced. One at a time makes the last reply the whole truth.
   */
  const resolveMatter = async (key: string, rows: readonly { id: string; answer: HoldAnswer }[]) => {
    const timezone = localTimezone()
    for (const row of rows) {
      const response = await resolve
        .mutateAsync({
          id: row.id,
          answer:
            row.answer.optionIndex !== null
              ? { type: 'option', index: row.answer.optionIndex }
              : { type: 'custom', text: row.answer.label },
          timezone,
        })
        // The mutation reports its own failures (toast + rollback); swallowing
        // the rejection keeps one failed answer from stranding the siblings
        // queued behind it. The row stays answered on screen either way — same
        // optimism the card has always had, and the question is still open in
        // /uncertainties.
        .catch(() => null)
      if (!response) continue
      setResolved((prev) => ({ ...prev, [key]: resolvedMatterFrom(response.task, prev[key]) }))
    }
  }

  const save = () => {
    if (disabled || stagedRows.length === 0) return

    const committed: Record<string, HoldAnswer> = {}
    // Holds the server never persisted. Their answers ride back through the
    // chat instead, as ONE message.
    const legacy: string[] = []

    for (const group of groups) {
      const pending: { id: string; answer: HoldAnswer }[] = []
      const multi = group.rows.filter(isAnswerable).length > 1

      for (const hold of group.rows) {
        if (!isAnswerable(hold) || saved[hold.rowKey]) continue
        const answer = answerFor(hold)
        if (!answer) continue
        committed[hold.rowKey] = answer

        if (hold.clarificationId) pending.push({ id: hold.clarificationId, answer })
        else legacy.push(legacyLine(hold, answer, multi))
      }

      if (pending.length > 0) void resolveMatter(group.key, pending)
    }

    setSaved((prev) => ({ ...prev, ...committed }))
    if (legacy.length === 1) onAnswer(legacy[0] ?? '')
    else if (legacy.length > 1) onAnswer(`${t('clarify.answersPrefix')}\n${legacy.join('\n')}`)
  }

  if (holds.length === 0) return null

  // Everything answered → the card STAYS, and states what it now holds. It used
  // to collapse to a bare "Updated." chip, which threw away the receipt: the
  // matter, its confirmed date, its priority. Past tense, and about the
  // CORRECTION rather than the filing — the matters were filed when the
  // questions were raised, so anything in the future tense here describes work
  // that finished before the user read it.
  //
  // A card with nothing answerable on it is neither open nor settled: it is a
  // statement of what was filed. No heading counting questions that were never
  // asked, and no Save — a control whose only possible act is to do nothing.
  const asks = answerable.length > 0
  const settled = asks && unsaved.length === 0

  return (
    <div className="flex w-full flex-col gap-3 rounded-2xl bg-surface p-4 shadow-card">
      {settled ? (
        // Matters, not questions: two asks about one dentist appointment
        // updated one matter.
        <span className="text-label uppercase text-ink-subtle">
          {t('clarify.saved', { count: answerableGroups.length })}
        </span>
      ) : answerable.length > 1 ? (
        <span className="text-label uppercase text-ink-subtle">
          {t('clarify.heading', { count: answerable.length })}
        </span>
      ) : null}

      {/* Every question at once, one block per matter. The divider is the only
          separation they get — a card per matter inside a card is the
          box-in-a-box the chat transcript already suffers from. */}
      <ul className="flex flex-col [&>li:not(:first-child)]:mt-3.5 [&>li:not(:first-child)]:border-t [&>li:not(:first-child)]:border-border/60 [&>li:not(:first-child)]:pt-3.5">
        {groups.map((group) => (
          <ClarificationMatter
            key={group.key}
            group={group}
            stateOf={stateOf}
            resolved={resolved[group.key] ?? null}
            disabled={disabled}
            onPick={pick}
            onDraft={draft}
            onReveal={(hold) => setTyping((prev) => ({ ...prev, [hold.rowKey]: true }))}
            onSubmit={save}
          />
        ))}
      </ul>

      {/* Nothing left open → no footer. A Save button with nothing to save is a
          control that can only disappoint. */}
      {!asks || settled ? null : (
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
      )}
    </div>
  )
}
