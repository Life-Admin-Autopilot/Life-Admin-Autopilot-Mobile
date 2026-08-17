'use client'

// One held matter inside the clarification card: what was filed, then every
// question being asked about it.
//
// The facts come FIRST and they are the whole matter — chip, title, date,
// priority, domain, and the warning when the date will not fire. They used to
// live on a separate receipt card stacked above this one, which meant one
// matter had two surfaces: the question here, the guess up there. Answering
// collapsed this half and left the other half insisting the matter still needed
// a detail, showing a time the user had just corrected.
//
// So this block owns both halves and both states, and it owns them ONCE for the
// matter no matter how many questions hang off it. Unanswered: eyebrow "Filed —
// needs a detail", the guessed date, the "won't remind until you confirm"
// caveat. Answered: eyebrow "Filed", the CONFIRMED date and title read back off
// the server's patched task, and the caveat replaced by the promise it became.
//
// While SOME questions are still open the caveat stays, even after an answer
// lands: a matter whose time is confirmed but whose date question is still
// unanswered has not been promised anything yet, and the whole point of this
// block is that it stops describing a state the matter is no longer in.

import { useTranslations } from 'next-intl'

import { ClarificationRow, type ClarificationRowState } from '@/components/chat/ClarificationRow'
import { MatterFacts, type ReminderState } from '@/components/chat/MatterFacts'
import { DomainIcon } from '@/components/icons/DomainIcon'
import type {
  HoldGroup,
  HoldOption,
  ParsedHold,
  ResolvedMatter,
} from '@/lib/ai/clarificationHolds'

interface ClarificationMatterProps {
  group: HoldGroup
  /** What the deck holds for one of this matter's questions. */
  stateOf: (row: ParsedHold) => ClarificationRowState
  /**
   * The matter as it stands AFTER an answer was written, from the resolve
   * response. Null until one lands (or when the rows resolved through the
   * legacy chat fallback, which patches nothing here).
   */
  resolved: ResolvedMatter | null
  disabled: boolean
  onPick: (row: ParsedHold, option: HoldOption) => void
  onDraft: (row: ParsedHold, value: string) => void
  onReveal: (row: ParsedHold) => void
  onSubmit: () => void
}

export function ClarificationMatter({
  group,
  stateOf,
  resolved,
  disabled,
  onPick,
  onDraft,
  onReveal,
  onSubmit,
}: ClarificationMatterProps) {
  const t = useTranslations('chat')

  const savedCount = group.rows.filter((row) => stateOf(row).saved).length
  const anySaved = savedCount > 0
  const allSaved = savedCount === group.rows.length

  // The answers win over the guesses they replaced. When the server sent
  // nothing back we still drop the caveat once every question is answered — a
  // "won't remind until you confirm" pill under a confirmation is the exact
  // stale line this card was rebuilt to kill.
  const fields = (anySaved ? resolved?.facts : null) ?? group.facts
  const title = (anySaved ? resolved?.title : '') || group.title
  const reminder: ReminderState | undefined = !anySaved
    ? undefined
    : fields?.dueAt && fields.willRemind
      ? 'confirmed'
      : allSaved
        ? 'none'
        : // A question is still open, so the guess is still a guess: let
          // MatterFacts derive the warning from the fields as it does unanswered.
          undefined

  return (
    <li className="flex flex-col gap-2.5">
      {fields ? (
        <MatterFacts
          eyebrow={allSaved ? t('clarify.filedEyebrow') : t('ledger.verb.holdForClarification')}
          title={title}
          fields={fields}
          reminder={reminder}
          warnLabel={t('clarify.noReminderUntil')}
        />
      ) : (
        // The hold saved no task (a failed call, or a transcript written before
        // the task rode back on the result). Name the matter and nothing else —
        // inventing pills for fields we do not hold is the opposite of the fix.
        <div className="flex items-center gap-2">
          {group.domain ? <DomainIcon domain={group.domain} size={24} /> : null}
          <span className="min-w-0 truncate text-caption text-ink-subtle" dir="auto">
            {title ? t('clarify.filed', { title }) : t('clarify.filedNoTitle')}
          </span>
        </div>
      )}

      {/* The questions, stacked under the facts they are about. The gap is the
          only separation between two asks on one matter — a divider here would
          split the matter from itself, and the dividers on this card mean "a
          different matter starts". A single question renders no gap at all, so
          the one-question card is untouched. */}
      <div className="flex flex-col gap-4">
        {group.rows.map((row) => (
          <ClarificationRow
            key={row.rowKey}
            hold={row}
            state={stateOf(row)}
            disabled={disabled}
            onPick={(option) => onPick(row, option)}
            onDraft={(value) => onDraft(row, value)}
            onReveal={() => onReveal(row)}
            onSubmit={onSubmit}
          />
        ))}
      </div>
    </li>
  )
}
