'use client'

import { Check, ChevronRight, ListChecks } from 'lucide-react'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'
import { bucketOf, formatDue } from '@/lib/taskFormat'
import type { Task } from '@/queries/tasks'

// One matter in the list. Keeps MatterRow's visual DNA — domain chip, title,
// accent-coloured due line, trailing affordance — and adds what a real,
// interactive list needs: a completion tap target, selection, priority, and
// subtask/tag density.
//
// Overdue reads in `accent`, never `danger`. A backlog rendered in red is the
// mechanism behind every "I opened it, saw the red, and deleted the app" story;
// `danger` is reserved for destructive confirmations.

const PRIORITY_PILL: Partial<Record<Task['priority'], { label: string; className: string }>> = {
  urgent: { label: 'Urgent', className: 'bg-danger-soft text-danger' },
  high: { label: 'High', className: 'bg-warning-soft text-warning' },
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
        'flex items-center gap-3 px-4 py-3 transition-colors',
        selected && 'bg-accent-soft/50',
      )}
    >
      {selectable ? (
        <button
          type="button"
          onClick={() => onToggleSelect?.(task)}
          aria-label={selected ? `Deselect ${task.title}` : `Select ${task.title}`}
          aria-pressed={selected}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors',
            selected
              ? 'border-accent bg-accent text-accent-ink'
              : 'border-border-strong bg-surface',
          )}
        >
          {selected ? <Check size={14} strokeWidth={3} /> : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onToggleDone(task)}
          aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          className="relative shrink-0"
        >
          <DomainIcon domain={task.domain} />
          {done ? (
            <span className="absolute inset-0 flex items-center justify-center rounded-md bg-accent text-accent-ink">
              <Check size={18} strokeWidth={3} />
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
            done ? 'text-ink-subtle line-through' : 'text-ink',
          )}
        >
          {task.title}
        </span>
        <span className="flex w-full items-center gap-1.5 truncate">
          <span
            className={cn(
              'text-caption tabular',
              overdue ? 'font-medium text-accent' : 'text-ink-muted',
            )}
          >
            {formatDue(task.dueAt, now)}
          </span>
          {openSubtasks > 0 ? (
            <span className="flex items-center gap-0.5 text-caption tabular text-ink-subtle">
              <ListChecks size={12} />
              {openSubtasks}
            </span>
          ) : null}
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="truncate text-caption text-ink-subtle">
              #{tag}
            </span>
          ))}
        </span>
      </button>

      {/* Sentence case, not caps. A shouted HIGH next to every other row is the
          same nagging that makes people stop opening the app — the tint already
          carries the signal. */}
      {priority && !done ? (
        <span
          className={cn('shrink-0 rounded-pill px-2 py-0.5 text-micro', priority.className)}
        >
          {priority.label}
        </span>
      ) : null}

      {!selectable ? <ChevronRight size={18} className="shrink-0 text-ink-subtle" /> : null}
    </div>
  )
}
