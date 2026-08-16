// The facts of one filed matter: chip, eyebrow, title, and the three values
// Kitto guessed — when, how urgent, which part of your life.
//
// Shared, because the same matter used to be described twice in one turn: a
// receipt card from the tool call AND a question card underneath it. The receipt
// went on saying "needs a detail" long after the question had been answered, so
// one fact had two surfaces and one of them was lying. There is one surface now,
// and this is the block both callers render — the chat receipt (ToolCallCard)
// and the row inside the clarification card.
//
// Deliberately echoes `MatterListRow`: same emoji chip, same title weight, so
// the thing in the conversation and the row in the list are recognisably the
// same object.

import { BellOff, BellRing, CalendarDays, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Pill, type PillTone } from '@/components/ui/Pill'
import type { ToolCallTaskFields } from '@/lib/ai/toolCallSummary'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDue } from '@/lib/taskFormat'
import type { TaskPriority } from '@/queries/tasks'

/**
 * What the block says about the reminder.
 *
 * `warn` — a date is filed but nothing will fire (the held high-stakes case).
 * `confirmed` — the user has since confirmed it; state when it rings instead.
 * `none` — say nothing.
 * Omitted — derive `warn`/`none` from the fields themselves.
 */
export type ReminderState = 'warn' | 'confirmed' | 'none'

interface MatterFactsProps {
  /** What happened, at label scale — the matter is the thing being checked. */
  eyebrow: string
  title: string
  fields: ToolCallTaskFields
  reminder?: ReminderState
  /** Copy for the warning pill. Defaults to the ledger's short form. */
  warnLabel?: string
}

// Priority always earns a pill — it is one of the three guesses this block
// exists to expose — but not the same pill. Rendering "Urgent" and "Normal"
// identically would put the level true of most matters at the weight of the one
// that isn't, so only the loud two take a coloured wash; the quiet two sit in
// `field`, the tone this app already uses for "a value that is set".
const PRIORITY_TONE: Record<TaskPriority, PillTone> = {
  urgent: 'high',
  high: 'medium',
  normal: 'field',
  low: 'low',
}

export function MatterFacts({ eyebrow, title, fields, reminder, warnLabel }: MatterFactsProps) {
  const tMatters = useTranslations('matters')
  const tDomain = useTranslations('domain')
  const tChat = useTranslations('chat')
  const tag = useIntlTag()

  const state: ReminderState = reminder ?? (fields.dueAt && !fields.willRemind ? 'warn' : 'none')
  const due = formatDue(fields.dueAt, { t: tMatters, tag })

  return (
    <div className="flex items-start gap-3">
      <DomainIcon domain={fields.domain} size={40} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {/* `text-label` rather than a literal tracking value — globals.css
            zeroes its letter-spacing under Arabic, where spacing between letters
            breaks the cursive join. */}
        <span className="flex items-center gap-1.5 text-label uppercase text-ink-subtle">
          <Check size={12} strokeWidth={3} className="shrink-0 text-accent" />
          {eyebrow}
        </span>

        {title ? (
          // Two lines, not a truncation: "Check health insurance rene…" hides
          // the half of the title that says which renewal it is.
          <span className="line-clamp-2 text-heading-sm text-ink" dir="auto">
            {title}
          </span>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5">
          {/* A confirmed date states the promise it now carries, and states it
              once: a "Reminds Tomorrow, 09:00" pill next to a bare
              "Tomorrow, 09:00" pill is the same fact printed twice. */}
          {state === 'confirmed' ? (
            <MetaPill icon={<BellRing size={12} strokeWidth={2.25} />}>
              {tChat('ledger.reminds', { when: due })}
            </MetaPill>
          ) : (
            <MetaPill icon={<CalendarDays size={12} strokeWidth={2.25} />}>
              <span className="tabular">{due}</span>
            </MetaPill>
          )}
          <MetaPill tone={PRIORITY_TONE[fields.priority]}>
            {tMatters(`priority.${fields.priority}`)}
          </MetaPill>
          {/* The word only. The emoji is already the chip on the left at 40px;
              repeating it at 12px inside the pill added a second, murkier copy
              of the one thing here that was never ambiguous. */}
          <MetaPill>{tDomain(fields.domain)}</MetaPill>
          {/* A date that is present but will never fire. Silence here would read
              the date pill as a promise Kitto has not made. */}
          {state === 'warn' ? (
            <MetaPill tone="warning" icon={<BellOff size={12} strokeWidth={2.25} />}>
              {warnLabel ?? tChat('ledger.noReminder')}
            </MetaPill>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Pills at meta scale. Same compact override the matter list row uses, so the
// two surfaces read as one system rather than two sizes of the same component.
export function MetaPill({
  tone = 'field',
  icon,
  children,
}: {
  tone?: PillTone
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Pill tone={tone} icon={icon} className="gap-1 px-2.5 py-0.5 text-micro">
      {children}
    </Pill>
  )
}
