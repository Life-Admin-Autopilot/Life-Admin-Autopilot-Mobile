'use client'

// One held matter inside the clarification card: what was filed, then what is
// being asked about it.
//
// The facts come FIRST and they are the whole matter — chip, title, date,
// priority, domain, and the warning when the date will not fire. They used to
// live on a separate receipt card stacked above this one, which meant one
// matter had two surfaces: the question here, the guess up there. Answering
// collapsed this half and left the other half insisting the matter still needed
// a detail, showing a time the user had just corrected.
//
// So this row owns both halves and both states. Unanswered: eyebrow "Filed —
// needs a detail", the guessed date, the "won't remind until you confirm"
// caveat. Answered: eyebrow "Filed", the CONFIRMED date read back off the
// server's patched task, and the caveat replaced by the promise it became.
//
// Presentational: every piece of state is owned by ClarificationDeck, because
// Save is a single control over the whole card and it has to know what each row
// is holding.

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { MatterFacts, type ReminderState } from '@/components/chat/MatterFacts'
import { DomainIcon } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'
import type { HoldAnswer, ParsedHold } from '@/lib/ai/clarificationHolds'
import type { ToolCallTaskFields } from '@/lib/ai/toolCallSummary'

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
  /**
   * The matter as it stands AFTER the answer was written, from the resolve
   * response. Null until it lands (or when the row resolved through the legacy
   * chat fallback, which patches nothing here).
   */
  resolvedFacts: ToolCallTaskFields | null
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
  resolvedFacts,
  disabled,
  onPick,
  onDraft,
  onReveal,
  onSubmit,
}: ClarificationRowProps) {
  const t = useTranslations('chat')
  const hasOptions = hold.options.length > 0
  const showInput = !hasOptions || typing

  // The answer wins over the guess it replaced. When the server sent nothing
  // back we still drop the caveat — the question has been answered, and a
  // "won't remind until you confirm" pill under a confirmation is the exact
  // stale line this card was rebuilt to kill.
  const fields = (saved ? resolvedFacts : null) ?? hold.facts
  const reminder: ReminderState | undefined = !saved
    ? undefined
    : fields?.dueAt && fields.willRemind
      ? 'confirmed'
      : 'none'

  return (
    <li className="flex flex-col gap-2.5">
      {fields ? (
        <MatterFacts
          eyebrow={saved ? t('clarify.filedEyebrow') : t('ledger.verb.holdForClarification')}
          title={hold.title}
          fields={fields}
          reminder={reminder}
          warnLabel={t('clarify.noReminderUntil')}
        />
      ) : (
        // The hold saved no task (a failed call, or a transcript written before
        // the task rode back on the result). Name the matter and nothing else —
        // inventing pills for fields we do not hold is the opposite of the fix.
        <div className="flex items-center gap-2">
          {hold.domain ? <DomainIcon domain={hold.domain} size={24} /> : null}
          <span className="min-w-0 truncate text-caption text-ink-subtle" dir="auto">
            {hold.title ? t('clarify.filed', { title: hold.title }) : t('clarify.filedNoTitle')}
          </span>
        </div>
      )}

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
