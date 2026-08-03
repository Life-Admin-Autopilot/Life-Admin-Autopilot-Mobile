'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, Plus, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { cn } from '@/lib/cn'
import { STEP_ITEM_VARIANTS, STEP_SPRING } from '@/lib/motion'
import {
  isPendingSubtaskId,
  useAddSubtask,
  useRemoveSubtask,
  useToggleSubtask,
  type Subtask,
  type Task,
} from '@/queries/tasks'

// The step checklist inside the matter editor.
//
// Every write here is optimistic (see queries/tasks.ts): the row appears, ticks
// and disappears on the frame it was asked to, and the server confirms behind
// it. Nothing on screen waits for a response, and a failed write rolls the cache
// back — so the only way to notice the network is for a step to reappear.

export function MatterSteps({ task }: { task: Task }) {
  const t = useTranslations('matters')
  const [draft, setDraft] = useState('')
  const reduced = useReducedMotion()

  const addSubtask = useAddSubtask()
  const toggleSubtask = useToggleSubtask()
  const removeSubtask = useRemoveSubtask()

  const keys = useStepKeys(task.subtasks)

  return (
    <>
      {/* popLayout, not the default: a removed step must stop taking up space
          immediately, otherwise the rows below it hold their old position for
          the length of the fade and the list feels stuck. It parks the leaving
          row absolutely, which needs a positioned ancestor to land against. */}
      <ul className="relative flex flex-col gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {task.subtasks.map((sub, i) => (
            <motion.li
              key={keys[i]}
              layout={reduced ? false : 'position'}
              variants={reduced ? undefined : STEP_ITEM_VARIANTS}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={STEP_SPRING}
              className="flex items-center gap-2"
            >
              <button
                type="button"
                onClick={() =>
                  toggleSubtask.mutate({ taskId: task.id, subtaskId: sub.id, done: !sub.done })
                }
                // Both controls address the step by id, and a step the server
                // hasn't answered for yet doesn't have one — the round trip is
                // short enough that waiting it out beats a 404 and a rollback.
                // Deliberately undimmed: flashing every new row grey for the
                // length of a request would read as breakage, not as caution.
                disabled={isPendingSubtaskId(sub.id)}
                aria-label={
                  sub.done
                    ? t('steps.reopen', { step: sub.text })
                    : t('steps.complete', { step: sub.text })
                }
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  sub.done ? 'border-accent bg-accent text-accent-ink' : 'border-border-strong',
                )}
              >
                {/* The tick springs in rather than snapping, which is the whole
                    of the reward for marking a step done. */}
                <AnimatePresence initial={false}>
                  {sub.done ? (
                    <motion.span
                      key="tick"
                      initial={reduced ? false : { scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={reduced ? { duration: 0 } : STEP_SPRING}
                      className="flex"
                    >
                      <Check size={12} strokeWidth={3} />
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </button>
              <span
                dir="auto"
                className={cn(
                  'flex-1 truncate text-body-sm transition-colors',
                  sub.done ? 'text-ink-subtle line-through' : 'text-ink',
                )}
              >
                {sub.text}
              </span>
              <button
                type="button"
                onClick={() => removeSubtask.mutate({ taskId: task.id, subtaskId: sub.id })}
                disabled={isPendingSubtaskId(sub.id)}
                aria-label={t('steps.remove', { step: sub.text })}
                className="text-ink-subtle transition-colors hover:text-danger"
              >
                <X size={14} />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {/* Slides down as steps arrive instead of jumping — it is the thing the
          user is aiming at, so it should stay under the cursor predictably. */}
      <motion.form
        layout={reduced ? false : 'position'}
        transition={STEP_SPRING}
        onSubmit={(e) => {
          e.preventDefault()
          const text = draft.trim()
          if (!text) return
          // Cleared up front, not in onSuccess: the row is already on screen, so
          // leaving the text in the field would read as "that didn't take".
          setDraft('')
          addSubtask.mutate({ taskId: task.id, text })
        }}
        className="flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('steps.add')}
          dir="auto"
          className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label={t('steps.addLabel')}
          className="rounded-md p-2 text-accent transition-opacity disabled:opacity-40"
        >
          <Plus size={16} />
        </button>
      </motion.form>
    </>
  )
}

// Rows are keyed by the identity they first mounted with, not by the id they
// currently carry.
//
// An optimistically added step holds a placeholder id until the server answers
// with the real one. Keying on `sub.id` would make that swap look like a removal
// and an insertion to AnimatePresence — the row would fade out and slide back in
// with text that never changed, a visible wobble on every single add. So a key
// whose placeholder just vanished is handed to whichever id turned up in the
// same render, which is exactly the server's answer to that row.
//
// Derived during render rather than in an effect: an effect would paint one
// frame keyed the old way, which is the exact frame the wobble happens on.
function useStepKeys(steps: Subtask[]): string[] {
  const [alias, setAlias] = useState<ReadonlyMap<string, string>>(() => new Map())

  const { keys, next } = resolveStepKeys(alias, steps)
  if (!sameEntries(alias, next)) setAlias(next)
  return keys
}

function resolveStepKeys(alias: ReadonlyMap<string, string>, steps: Subtask[]) {
  // A key whose placeholder is no longer in the list is up for adoption. Ids the
  // server issued are never recycled this way — those really did go away.
  const present = new Set(steps.map((s) => s.id))
  const orphaned: string[] = []
  for (const [id, key] of alias) {
    if (!present.has(id) && isPendingSubtaskId(id)) orphaned.push(key)
  }

  const next = new Map<string, string>()
  const keys = steps.map((s) => {
    const key = alias.get(s.id) ?? orphaned.shift() ?? s.id
    next.set(s.id, key)
    return key
  })
  return { keys, next }
}

function sameEntries(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}
