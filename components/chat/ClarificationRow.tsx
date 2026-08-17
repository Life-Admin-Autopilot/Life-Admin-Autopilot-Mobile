'use client'

// ONE question inside the clarification card: the ask, then the affordances for
// answering it — chips, free text, and the tick it collapses to once saved.
//
// The facts of the matter are NOT here. They live once per matter, above the
// questions, in ClarificationMatter — because a hold can raise two questions
// about one filed thing ("What time?" and "Which friend?"), and printing the
// chip, title, date and priority above each of them describes one matter twice
// on one card.
//
// Presentational: every piece of state is owned by ClarificationDeck, because
// Save is a single control over the whole card and it has to know what each row
// is holding. Resolving one question must not touch its sibling — the answered
// one collapses to its tick, the sibling stays interactive — which is exactly
// what per-row state buys.

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { timeChipLabel } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import type { HoldAnswer, HoldOption, ParsedHold } from '@/lib/ai/clarificationHolds'

/** What the deck is holding for one question. */
export interface ClarificationRowState {
  /** What is staged for this row, or null while it is unanswered. */
  answer: HoldAnswer | null
  /** Free-text draft — separate from `answer` so a pick can be typed over. */
  draft: string
  /** Is the free-text field revealed on a row that also offers options? */
  typing: boolean
  /** Already resolved by an earlier Save on this card. */
  saved: boolean
}

interface ClarificationRowProps {
  hold: ParsedHold
  state: ClarificationRowState
  disabled: boolean
  onPick: (option: HoldOption) => void
  onDraft: (value: string) => void
  onReveal: () => void
  onSubmit: () => void
}

export function ClarificationRow({
  hold,
  state,
  disabled,
  onPick,
  onDraft,
  onReveal,
  onSubmit,
}: ClarificationRowProps) {
  const t = useTranslations('chat')
  const tag = useIntlTag()
  const { answer, draft, typing, saved } = state
  const hasOptions = hold.options.length > 0
  const showInput = !hasOptions || typing

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-body-sm font-semibold text-ink" dir="auto">
        {hold.question || t('clarify.fallbackQuestion')}
      </p>

      {saved ? (
        // Resolved on a previous Save. Kept in place rather than removed: the
        // question and the answer read together, and a row vanishing out of a
        // card the user is still working down is a moving target.
        <div className="flex items-center gap-1.5">
          <Check size={13} strokeWidth={2.5} className="shrink-0 text-accent" />
          <span className="truncate text-caption text-ink-muted" dir="auto">
            {answer ? timeChipLabel(answer.label, answer.dueAt, tag) : null}
          </span>
        </div>
      ) : (
        <>
          {hasOptions ? (
            <div className="flex flex-wrap gap-2">
              {hold.options.map((option) => {
                const picked = answer?.optionIndex === option.index
                return (
                  <button
                    key={`${hold.rowKey}-${option.index}`}
                    type="button"
                    disabled={disabled}
                    aria-pressed={picked}
                    onClick={() => onPick(option)}
                    className={cn(
                      'rounded-pill border px-3 py-1.5 text-caption transition-colors disabled:opacity-50',
                      picked
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-border bg-surface text-ink hover:bg-surface-sunken',
                    )}
                  >
                    {timeChipLabel(option.label, option.dueAt, tag)}
                  </button>
                )
              })}
            </div>
          ) : null}

          {showInput ? (
            <input
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSubmit()
              }}
              placeholder={t('clarify.replyPlaceholder')}
              aria-label={hold.question || t('clarify.fallbackQuestion')}
              disabled={disabled}
              dir="auto"
              className="h-10 min-w-0 rounded-xl bg-surface-field px-3.5 text-body-sm text-ink outline-none placeholder:text-ink-muted disabled:opacity-50"
            />
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={onReveal}
              className="self-start text-caption text-ink-subtle transition-colors hover:text-ink disabled:opacity-50"
            >
              {t('clarify.typeReply')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
