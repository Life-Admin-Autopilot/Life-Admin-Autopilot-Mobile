'use client'

import { AlertTriangle, Check, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useDomainLabels } from '@/hooks/useDomainLabels'
import { useState } from 'react'

import { ConflictNotice } from '@/components/matters/ConflictNotice'
import { MatterSteps } from '@/components/matters/MatterSteps'
import { TimeProvenance } from '@/components/matters/TimeProvenance'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import {
  SNOOZE_PRESETS,
  fromLocalInputValue,
  toLocalInputValue,
} from '@/lib/taskFormat'
import {
  TASK_DOMAINS,
  TASK_PRIORITIES,
  useDeleteTask,
  useUpdateTask,
  type Task,
  type TaskDomain,
  type TaskPriority,
  type UpdateTaskBody,
} from '@/queries/tasks'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'
import { previewConflicts, type DraftConflict } from '@/queries/planning'

// The single matter editor. Same field set and chip vocabulary as the document
// scan review (components/scan/TaskOverview), so editing a matter feels the
// same wherever you reached it from.
//
// Saves a DIFF, not the whole draft: sending unchanged fields would bump
// `updatedAt` on everything and — for dueAt — trip the reschedule counter that
// the "what's slipping" signal depends on.

// The priority chips read `matters.priority.*`, the same four keys the filter
// sheet and the list row read. A local Record here was a second English-only
// copy of them, and one that could not call useTranslations besides.

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
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  const domainLabels = useDomainLabels()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(task))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

  // The pre-save clash check: what it found, and whether the user has now seen it.
  const [clashes, setClashes] = useState<DraftConflict[]>([])
  const [overrideClash, setOverrideClash] = useState(false)
  const [checking, setChecking] = useState(false)

  const patch = (p: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...p }))
    // Any further edit is a different change, so a warning about the previous one
    // must not still be standing — and must not count as consent to this one.
    setClashes([])
    setOverrideClash(false)
  }

  const save = async () => {
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

    // Ask before writing, not after.
    //
    // ConflictNotice below already reports a clash — but only once the edit has
    // landed, which makes it a report on damage rather than a chance to avoid it.
    // Moving a matter onto another one is the case the user is least likely to
    // have intended and most likely to want back, so the first Save on a
    // newly-clashing time shows what it collides with and asks again. The second
    // tap is the decision.
    const movingInTime = body.dueAt !== undefined && body.dueAt !== null
    if (movingInTime && !overrideClash) {
      setChecking(true)
      const found = await previewConflicts(task.id, { dueAt: body.dueAt, title })
      setChecking(false)
      if (found.length > 0) {
        setClashes(found)
        setOverrideClash(true)
        return
      }
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
      eyebrow={t('detail.eyebrow')}
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
            {confirmDelete ? t('detail.confirmDelete') : tCommon('delete')}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
            >
              {tCommon('cancel')}
            </button>
            <Button
              className={cn('h-8 gap-1 px-3 text-caption', overrideClash && 'bg-warning')}
              disabled={updateTask.isPending || checking || !draft.title.trim()}
              onClick={() => void save()}
            >
              <Check size={14} />
              {updateTask.isPending || checking
                ? tCommon('saving')
                : overrideClash
                  ? t('detail.saveAnyway')
                  : tCommon('save')}
            </Button>
          </div>
        </div>
      }
    >
      {/* What THIS unsaved edit would collide with. Takes the place of the
          saved-state notice while it is showing, so the user reads one warning
          about the change in front of them rather than two about different
          moments in time. */}
      {clashes.length > 0 ? (
        <div className="mb-3 rounded-2xl bg-warning/10 p-3">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0 text-warning" />
            <p className="text-label uppercase tracking-wide text-warning">
              {t('detail.clashNotSaved')}
            </p>
          </div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {clashes.map((conflict) => (
              <li key={conflict.taskId} className="text-body-sm text-ink" dir="auto">
                {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        /* The Knowledge Agent's re-check. Sits above the fields that cause a
           clash, so an edit that creates one is answered where it was made. */
        <ConflictNotice taskId={task.id} />
      )}

      <SheetSection label={t('section.domain')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_DOMAINS.map((d) => (
            <ChipToggle key={d} selected={draft.domain === d} onClick={() => patch({ domain: d })}>
              {domainLabels[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={t('section.priority')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_PRIORITIES.map((p) => (
            <ChipToggle
              key={p}
              selected={draft.priority === p}
              onClick={() => patch({ priority: p })}
            >
              {t(`priority.${p}`)}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={t('section.due')}>
        <TimeProvenance task={task} />
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            value={toLocalInputValue(draft.dueAt)}
            onChange={(e) => patch({ dueAt: fromLocalInputValue(e.target.value) })}
            aria-label={t('detail.dueLabel')}
            className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none"
          />
          {draft.dueAt ? (
            <button
              type="button"
              onClick={() => patch({ dueAt: undefined })}
              className="text-caption text-ink-subtle hover:text-ink"
            >
              {tCommon('clear')}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SNOOZE_PRESETS.map((preset) => (
            <ChipToggle
              key={preset.labelKey}
              selected={false}
              onClick={() => patch({ dueAt: preset.at(new Date()).toISOString() })}
            >
              {t(`snooze.${preset.labelKey}`)}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection
        label={
          task.subtasks.length > 0
            ? t('detail.stepsCount', { count: task.subtasks.length })
            : t('section.steps')
        }
      >
        <MatterSteps task={task} />
      </SheetSection>

      {/* Everything below Steps rides its growth, so it slides rather than
          snapping to a new position each time a step is added or removed. */}
      <SheetSection label={t('section.notes')} animateLayout>
        <textarea
          value={draft.notes ?? ''}
          onChange={(e) => patch({ notes: e.target.value })}
          dir="auto"
          aria-label={t('section.notes')}
          className="min-h-20 rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none"
        />
      </SheetSection>

      {task.rescheduleCount >= 3 ? (
        <p className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-body-sm text-ink-muted">
          {t('detail.rescheduled', { count: task.rescheduleCount })}
        </p>
      ) : null}

      {updateTask.isError ? (
        <p className="text-caption text-danger">{t('detail.saveFailed')}</p>
      ) : null}
    </Sheet>
  )
}
