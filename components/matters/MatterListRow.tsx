'use client'

import { ChevronRight, ListChecks } from 'lucide-react'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Pill } from '@/components/ui/Pill'
import { SelectionCheck } from '@/components/ui/CompletionRing'
import { cn } from '@/lib/cn'
import { bucketOf, formatDue } from '@/lib/taskFormat'
import type { Task } from '@/queries/tasks'

// One matter in the list. Emoji chip · title · quiet meta line · trailing
// affordance — the same shape the dashboard uses, plus what a real interactive
// list needs: a completion tap target, selection, priority, subtask density.
//
// Overdue reads in `accent`, never `danger`. A backlog rendered in red is the
// mechanism behind every "I opened it, saw the red, and deleted the app" story;
// `danger` is reserved for destructive confirmations.

const PRIORITY_PILL: Partial<Record<Task['priority'], { label: string; tone: 'high' | 'medium' }>> =
  {
    urgent: { label: 'Urgent', tone: 'high' },
    high: { label: 'High', tone: 'medium' },
  }

export function MatterListRow({
  task,
  onOpen,
  onToggleDone,
  selectable = false,
  selected = false,
  onToggleSelect,
  now,
}: {
  task: Task
  /** Receives the row's rect so the detail sheet can morph out of it. */
  onOpen: (task: Task, rect: DOMRect) => void
  onToggleDone: (task: Task) => void
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (task: Task) => void
  now?: Date
}) {
  const done = task.status === 'done'
  const overdue = bucketOf(task, now) === 'overdue'
  const priority = PRIORITY_PILL[task.priority]
  const openSubtasks = task.subtasks.filter((s) => !s.done).length

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card transition-colors',
        selected && 'bg-accent-soft',
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(task)}
          aria-label={selected ? `Deselect ${task.title}` : `Select ${task.title}`}
          aria-pressed={selected}
          className="shrink-0"
        >
          <SelectionCheck checked={selected} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onToggleDone(task)}
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          className="relative shrink-0 transition-transform active:scale-95"
        >
          <DomainIcon domain={task.domain} />
          {done ? (
            <span className="absolute inset-0 grid place-items-center rounded-full bg-solid/85 text-solid-ink">
              <ListChecks size={18} strokeWidth={2.5} />
            </span>
          ) : null}
        </button>
      )}

      <button
        type="button"
        onClick={(e) =>
          selectable
            ? onToggleSelect?.(task)
            : // Measure the whole row, not the label, so the morph starts from
              // the full card edge the user actually sees.
              onOpen(task, (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())
        }
        className="flex min-w-0 flex-1 flex-col items-start text-left"
      >
        <span
          className={cn(
            'w-full truncate text-heading-sm',
            done ? 'text-ink-muted line-through decoration-ink-subtle' : 'text-ink',
          )}
        >
          {task.title}
        </span>
        {/* Priority sits on the meta line, not in the trailing slot. A pill
            parked at the right edge steals ~70px from every title on a phone,
            and the title is the only thing on this row anyone actually reads.
            Sentence case, not caps — a shouted HIGH beside every row is the
            same nagging that makes people stop opening the app. */}
        <span className="flex w-full items-center gap-1.5 truncate">
          {priority && !done ? (
            <Pill tone={priority.tone} className="shrink-0 px-2 py-0 text-micro">
              {priority.label}
            </Pill>
          ) : null}
          <span
            className={cn('text-body-sm tabular', overdue ? 'font-bold text-accent' : 'text-ink-muted')}
          >
            {formatDue(task.dueAt, now)}
          </span>
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

      {!selectable ? <ChevronRight size={18} className="shrink-0 text-ink-subtle" /> : null}
    </div>
  )
}
