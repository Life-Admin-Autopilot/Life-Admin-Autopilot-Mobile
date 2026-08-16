'use client'

// One question inside the clarification card.
//
// Presentational: every piece of state (which option is picked, what has been
// typed, whether the row is already resolved) is owned by ClarificationDeck,
// because Save is a single control over the whole card and it has to know what
// each row is holding.
//
// The eyebrow states the fact the card exists to make unmissable: the matter is
// ALREADY FILED. `holdForClarification` creates the task and attaches the
// question to it, so this is a correction the user may make, not a form standing
// between them and a task that was never saved.

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'
import type { HoldAnswer, ParsedHold } from '@/lib/ai/clarificationHolds'

interface ClarificationRowProps {
  hold: ParsedHold
  /** What is staged for this row, or null while it is unanswered. */
  answer: HoldAnswer | null
  /** Free-text draft — separate from `answer` so a pick can be typed over. */
  draft: string
  /** Is the free-text field revealed on a row that also offers options? */
  typing: boolean
  /** Already resolved by an earlier Save on this card. */
  saved: boolean
  disabled: boolean
  onPick: (option: { label: string; index: number }) => void
  onDraft: (value: string) => void
  onReveal: () => void
  onSubmit: () => void
}

export function ClarificationRow({
  hold,
  answer,
  draft,
  typing,
  saved,
  disabled,
  onPick,
  onDraft,
  onReveal,
  onSubmit,
}: ClarificationRowProps) {
  const t = useTranslations('chat')
  const hasOptions = hold.options.length > 0
  const showInput = !hasOptions || typing

  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {hold.domain ? <DomainIcon domain={hold.domain} size={24} /> : null}
        <span className="min-w-0 truncate text-caption text-ink-subtle" dir="auto">
          {hold.title ? t('clarify.filed', { title: hold.title }) : t('clarify.filedNoTitle')}
        </span>
      </div>

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
            {answer?.label}
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
                    key={`${hold.callId}-${option.index}`}
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
                    {option.label}
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
    </li>
  )
}
