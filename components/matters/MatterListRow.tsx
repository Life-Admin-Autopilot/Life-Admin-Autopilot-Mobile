'use client'

import { ListChecks } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useTranslations } from 'next-intl'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Pill } from '@/components/ui/Pill'
import { CompletionRing, SelectionCheck } from '@/components/ui/CompletionRing'
import { cn } from '@/lib/cn'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatCurrencyRounded } from '@/lib/i18n/numberFormat'
import { useLongPress } from '@/lib/useLongPress'
import { bucketOf, formatDue } from '@/lib/taskFormat'
import type { Task } from '@/queries/tasks'

// One matter in the list. Emoji chip · title · quiet meta line · completion
// ring — the same shape the dashboard uses, plus what a real interactive list
// needs: a done control, selection, priority, subtask density.
//
// Overdue reads in `accent`, never `danger`. A backlog rendered in red is the
// mechanism behind every "I opened it, saw the red, and deleted the app" story;
// `danger` is reserved for destructive confirmations.
//
// The emoji chip is IDENTITY, not a control. It used to double as the
// toggle-done target, which meant the one glyph telling you which part of your
// life a row belongs to also silently completed it — an unlabelled, unguessable
// action sitting on the element the eye lands on first, with no way to tell it
// apart from decoration. Completion now has its own `CompletionRing` in the
// trailing slot, where a checkbox is expected and reads as one.
//
// Unlike DocumentRow, this row cannot be one big <button>: the ring and the
// body are two separate actions and buttons cannot nest. So the open action is
// STRETCHED across the whole card with an `after:inset-0` overlay — padding,
// gaps, and the space under the ring included — and only the controls are
// lifted above it (`z-10`). Without that the tappable region is just the text's
// content box, and every tap on the card's right half or its vertical padding
// lands on nothing.

// Only the two loud priorities get a pill; "normal" and "low" say nothing worth
// the width. The label is NOT restated here — `matters.priority.*` already
// carries all four for the filter and the editor, so this maps to a tone only
// and the row reads the shared key.
const PRIORITY_TONE: Partial<Record<Task['priority'], 'high' | 'medium'>> = {
  urgent: 'high',
  high: 'medium',
}

export function MatterListRow({
  task,
  onOpen,
  onToggleDone,
  selectable = false,
  selected = false,
  onToggleSelect,
  onLongPress,
  now,
}: {
  task: Task
  /** Receives the row's rect so the detail sheet can morph out of it. */
  onOpen: (task: Task, rect: DOMRect) => void
  onToggleDone: (task: Task) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (task: Task) => void
  /** Press and hold to enter selection mode with this row already picked. */
  onLongPress?: (task: Task) => void
  now?: Date
}) {
  const reduced = useReducedMotion()
  // On the OUTER card, not the inner button: a hold anywhere on the row should
  // work, including the padding and the space under the completion ring. Every
  // inner control then has to consume the release-click, or lifting the finger
  // after a hold would also tick the ring / open the sheet behind the selection
  // UI that just appeared.
  const press = useLongPress(onLongPress ? () => onLongPress(task) : undefined, selectable)
  const done = task.status === 'done'
  const t = useTranslations('matters')
  const tag = useIntlTag()
  const overdue = !done && bucketOf(task, now) === 'overdue'
  const priorityTone = PRIORITY_TONE[task.priority]
  const openSubtasks = task.subtasks.filter((s) => !s.done).length

  return (
    <div
      {...press.handlers}
      className={cn(
        'relative flex select-none items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card',
        // The whole card is one press target now, so it gets the card-level
        // press feedback the rest of the app uses.
        'transition-[background-color,transform] active:scale-[0.99]',
        selected && 'bg-accent-soft',
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={() => {
            if (press.consumeClick()) return
            onToggleSelect?.(task)
          }}
          aria-label={
            selected
              ? t('row.deselect', { title: task.title })
              : t('row.select', { title: task.title })
          }
          aria-pressed={selected}
          className="relative z-10 shrink-0"
        >
          <SelectionCheck checked={selected} />
        </button>
      ) : (
        // Identity only. Not a button — see the note above.
        <DomainIcon
          domain={task.domain}
          className={cn('transition-opacity duration-300', done && 'opacity-50')}
        />
      )}

      <button
        type="button"
        onClick={(e) => {
          if (press.consumeClick()) return
          if (selectable) {
            onToggleSelect?.(task)
            return
          }
          // Measure the whole row, not the label, so the morph starts from
          // the full card edge the user actually sees.
          onOpen(task, (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())
        }}
        className="flex min-w-0 flex-1 flex-col items-start text-start after:absolute after:inset-0 after:content-['']"
      >
        <span
          className={cn(
            'w-full truncate text-heading-sm transition-colors duration-300',
            done ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {/* The strike is a scaling line rather than `text-decoration:
              line-through`, which CSS cannot transition — it would snap on at
              full width the instant the status flips. The inner span shrinks to
              the text so the rule stops at the last character instead of running
              the width of the row; on a truncated title the overflow clips it. */}
          <span className="relative">
            {task.title}
            <motion.span
              aria-hidden
              initial={false}
              animate={{ scaleX: done ? 1 : 0 }}
              transition={
                reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 32 }
              }
              // The strike is drawn by animating scaleX from 0, so it has to
              // grow from the edge the text starts at — otherwise in Arabic the
              // line sweeps backwards across the title. Tailwind has no logical
              // transform-origin, so the direction is named explicitly.
              className="pointer-events-none absolute inset-x-0 top-1/2 h-0.5 origin-left rounded-pill bg-current rtl:origin-right"
            />
          </span>
        </span>
        {/* Priority sits on the meta line, not in the trailing slot. A pill
            parked at the right edge steals ~70px from every title on a phone,
            and the title is the only thing on this row anyone actually reads.
            Sentence case, not caps — a shouted HIGH beside every row is the
            same nagging that makes people stop opening the app. */}
        <span
          className={cn(
            'flex w-full items-center gap-1.5 truncate transition-opacity duration-300',
            done && 'opacity-55',
          )}
        >
          {priorityTone && !done ? (
            <Pill tone={priorityTone} className="shrink-0 px-2 py-0 text-micro">
              {t(`priority.${task.priority}`)}
            </Pill>
          ) : null}
          <span
            className={cn('text-body-sm tabular', overdue ? 'font-bold text-accent' : 'text-ink-muted')}
          >
            {formatDue(task.dueAt, { t, tag, now })}
          </span>
          {/* What it costs, on the row rather than only inside the editor.
              A matter that carries a figure is a matter you decide about
              differently, and until this was here the Matters tab was the one
              screen in the app that knew the amount and never said it — the
              money tab totalled it, the row beside it showed a bare title. */}
          {task.amount ? (
            <span className="shrink-0 text-body-sm tabular text-ink-subtle">
              {formatCurrencyRounded(task.amount.amountMinor, task.amount.currency, tag)}
            </span>
          ) : null}
          {openSubtasks > 0 ? (
            <span className="flex items-center gap-0.5 text-body-sm tabular text-ink-subtle">
              <ListChecks size={13} />
              {openSubtasks}
            </span>
          ) : null}
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="truncate text-body-sm text-ink-subtle">
              #{tag}
            </span>
          ))}
        </span>
      </button>

      {!selectable ? (
        <CompletionRing
          checked={done}
          onChange={() => {
            if (press.consumeClick()) return
            onToggleDone(task)
          }}
          label={
            done ? t('row.reopen', { title: task.title }) : t('row.complete', { title: task.title })
          }
          className="relative z-10"
        />
      ) : null}
    </div>
  )
}
