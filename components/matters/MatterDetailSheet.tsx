'use client'

import { Check, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import {
  SNOOZE_PRESETS,
  fromLocalInputValue,
  toLocalInputValue,
} from '@/lib/taskFormat'
import {
  DOMAIN_LABEL,
  TASK_DOMAINS,
  TASK_PRIORITIES,
  useAddSubtask,
  useDeleteTask,
  useRemoveSubtask,
  useToggleSubtask,
  useUpdateTask,
  type Task,
  type TaskDomain,
  type TaskPriority,
  type UpdateTaskBody,
} from '@/queries/tasks'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'

// The single matter editor. Same field set and chip vocabulary as the document
// scan review (components/scan/TaskOverview), so editing a matter feels the
// same wherever you reached it from.
//
// Saves a DIFF, not the whole draft: sending unchanged fields would bump
// `updatedAt` on everything and — for dueAt — trip the reschedule counter that
// the "what's slipping" signal depends on.

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

interface Draft {
  title: string
  domain: TaskDomain
  priority: TaskPriority
  dueAt?: string
  notes?: string
  tags: string[]
}

function draftFrom(task: Task): Draft {
  return {
    title: task.title,
    domain: task.domain,
    priority: task.priority,
    dueAt: task.dueAt,
    notes: task.notes,
    tags: task.tags,
  }
}

// The editor outlives the caller's `task`, and `open` drives the morph.
//
// Returning null the moment `task` cleared used to unmount the Sheet — and with
// it the AnimatePresence that owns the collapse — on the very frame the close
// was requested, so the exit never ran and the sheet blinked out of existence.
// A closed Sheet renders nothing but an inert measuring probe, so keeping it
// mounted costs nothing and the collapse gets to play.
//
// Nothing waits on that collapse: a matter tapped mid-exit opens immediately,
// remounting the editor while the old shell finishes receding on its own.
export function MatterDetailSheet({
  task,
  trigger,
  onClose,
  onDeleted,
}: {
  task: Task | null
  trigger?: DOMRect | null
  onClose: () => void
  onDeleted: (undoToken: string | null, title: string) => void
}) {
  const open = Boolean(task)

  const [shown, setShown] = useState(task)
  if (task && task !== shown) setShown(task)

  // Every open is its own editing session, so the key changes on each open and
  // not only when the matter does — that's what remounts the editor with a
  // draft seeded from what's actually saved, discarding an abandoned edit and
  // disarming the delete button. Both of these are derived during render rather
  // than in an effect, which would paint one frame of the previous session's
  // fields before correcting itself.
  const [session, setSession] = useState({ n: 0, open })
  if (session.open !== open) setSession((s) => ({ n: open ? s.n + 1 : s.n, open }))

  if (!shown) return null
  return (
    <Editor
      key={`${shown.id}:${session.n}`}
      open={open}
      task={shown}
      trigger={trigger}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  )
}

function Editor({
  open,
  task,
  trigger,
  onClose,
  onDeleted,
}: {
  open: boolean
  task: Task
  trigger?: DOMRect | null
  onClose: () => void
  onDeleted: (undoToken: string | null, title: string) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task))
  const [newSubtask, setNewSubtask] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const addSubtask = useAddSubtask()
  const toggleSubtask = useToggleSubtask()
  const removeSubtask = useRemoveSubtask()

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))

  const save = () => {
    const body: UpdateTaskBody = {}
    const title = draft.title.trim()
    if (title && title !== task.title) body.title = title
    if (draft.domain !== task.domain) body.domain = draft.domain
    if (draft.priority !== task.priority) body.priority = draft.priority
    if (draft.dueAt !== task.dueAt) body.dueAt = draft.dueAt ?? null
    if ((draft.notes ?? '') !== (task.notes ?? '')) body.notes = draft.notes?.trim() || null
    if (draft.tags.join(',') !== task.tags.join(',')) body.tags = draft.tags

    if (Object.keys(body).length === 0) {
      onClose()
      return
    }
    updateTask.mutate({ taskId: task.id, body }, { onSuccess: onClose })
  }

  const remove = () => {
    deleteTask.mutate(task.id, {
      onSuccess: (res) => {
        onDeleted(res.undoToken, task.title)
        onClose()
      },
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={620}
      eyebrow="Matter"
      title={task.title}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => (confirmDelete ? remove() : setConfirmDelete(true))}
            disabled={deleteTask.isPending}
            className={cn(
              'flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-caption transition-colors disabled:opacity-50',
              confirmDelete
                ? 'bg-danger-soft text-danger'
                : 'text-ink-subtle hover:bg-surface-sunken hover:text-ink',
            )}
          >
            <Trash2 size={14} />
            {/* One tap arms, the second commits — and the copy says what happens
                next, because the delete is recoverable and saying so lowers the
                stakes of an honest mistake. */}
            {confirmDelete ? 'Tap again to delete' : 'Delete'}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              Cancel
            </button>
            <Button
              className="h-8 gap-1 px-3 text-caption"
              disabled={updateTask.isPending || !draft.title.trim()}
              onClick={save}
            >
              <Check size={14} />
              {updateTask.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
   

      <SheetSection label="Domain">
        <div className="flex flex-wrap gap-1.5">
          {TASK_DOMAINS.map((d) => (
            <ChipToggle key={d} selected={draft.domain === d} onClick={() => patch({ domain: d })}>
              {DOMAIN_LABEL[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Priority">
        <div className="flex flex-wrap gap-1.5">
          {TASK_PRIORITIES.map((p) => (
            <ChipToggle
              key={p}
              selected={draft.priority === p}
              onClick={() => patch({ priority: p })}
            >
              {PRIORITY_LABEL[p]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Due">
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={toLocalInputValue(draft.dueAt)}
            onChange={(e) => patch({ dueAt: fromLocalInputValue(e.target.value) })}
            aria-label="Due date"
            className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none"
          />
          {draft.dueAt ? (
            <button
              type="button"
              onClick={() => patch({ dueAt: undefined })}
              className="text-caption text-ink-subtle hover:text-ink"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SNOOZE_PRESETS.map((preset) => (
            <ChipToggle
              key={preset.label}
              selected={false}
              onClick={() => patch({ dueAt: preset.at(new Date()).toISOString() })}
            >
              {preset.label}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={`Steps${task.subtasks.length > 0 ? ` · ${task.subtasks.length}` : ''}`}>
        <ul className="flex flex-col gap-1">
          {task.subtasks.map((sub) => (
            <li key={sub.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  toggleSubtask.mutate({ taskId: task.id, subtaskId: sub.id, done: !sub.done })
                }
                aria-label={sub.done ? `Reopen ${sub.text}` : `Complete ${sub.text}`}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  sub.done ? 'border-accent bg-accent text-accent-ink' : 'border-border-strong',
                )}
              >
                {sub.done ? <Check size={12} strokeWidth={3} /> : null}
              </button>
              <span
                className={cn(
                  'flex-1 truncate text-body-sm',
                  sub.done ? 'text-ink-subtle line-through' : 'text-ink',
                )}
              >
                {sub.text}
              </span>
              <button
                type="button"
                onClick={() => removeSubtask.mutate({ taskId: task.id, subtaskId: sub.id })}
                aria-label={`Remove ${sub.text}`}
                className="text-ink-subtle hover:text-danger"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const text = newSubtask.trim()
            if (!text) return
            addSubtask.mutate({ taskId: task.id, text }, { onSuccess: () => setNewSubtask('') })
          }}
          className="flex items-center gap-2"
        >
          <input
            value={newSubtask}
            onChange={(e) => setNewSubtask(e.target.value)}
            placeholder="Add a step"
            dir="auto"
            className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="submit"
            disabled={!newSubtask.trim()}
            aria-label="Add step"
            className="rounded-md p-2 text-accent disabled:opacity-40"
          >
            <Plus size={16} />
          </button>
        </form>
      </SheetSection>

      <SheetSection label="Notes">
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => patch({ notes: e.target.value })}
          dir="auto"
          aria-label="Notes"
          className="min-h-20 rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none"
        />
      </SheetSection>

      {task.rescheduleCount >= 3 ? (
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-body-sm text-ink-muted">
          You&apos;ve moved this {task.rescheduleCount} times. Still worth keeping?
        </p>
      ) : null}

      {updateTask.isError ? (
        <p className="text-caption text-danger">Couldn&apos;t save that change. Try again.</p>
      ) : null}
    </Sheet>
  )
}
