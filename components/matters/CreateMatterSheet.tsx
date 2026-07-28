'use client'

import { useEffect, useState } from 'react'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MorphSheet, SheetSection } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { fromLocalInputValue } from '@/lib/taskFormat'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import {
  DOMAIN_LABEL,
  TASK_DOMAINS,
  useCreateTask,
  type TaskDomain,
  type TaskPriority,
} from '@/queries/tasks'

// Add a matter by hand.
//
// Everything except the title is OPTIONAL and pre-answered. Capture is the
// highest-frequency action in the app and the moment where a half-formed
// thought is most easily lost — a form that demands a domain, a date and a
// priority before it will accept "renew the car insurance" loses the thought
// while the user is still picking radio buttons. Domain defaults to Home
// (the server requires one), the date defaults to none, and Save is reachable
// the instant there is a title.
//
// The date offers relative chips rather than a picker. "Tomorrow" is one tap
// and no arithmetic; a calendar is three taps and asks the user to work out
// what tomorrow's number is, which is precisely the arithmetic a planner
// exists to remove.

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

/** Relative offsets, resolved against `now` at save time. */
const WHEN = [
  { key: 'none', label: 'No date' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'week', label: 'Next week' },
  { key: 'custom', label: 'Pick a date' },
] as const

type WhenKey = (typeof WHEN)[number]['key']

function resolveDue(key: WhenKey, custom: string, now: Date): string | undefined {
  if (key === 'none') return undefined
  if (key === 'custom') return fromLocalInputValue(custom)
  const at = new Date(now)
  if (key === 'today') at.setHours(18, 0, 0, 0)
  if (key === 'tomorrow') {
    at.setDate(at.getDate() + 1)
    at.setHours(9, 0, 0, 0)
  }
  if (key === 'week') {
    at.setDate(at.getDate() + 7)
    at.setHours(9, 0, 0, 0)
  }
  return at.toISOString()
}

export function CreateMatterSheet({
  open,
  trigger,
  onClose,
}: {
  open: boolean
  /** Rect of the + button, so the sheet grows out of it. */
  trigger: DOMRect | null
  onClose: () => void
}) {
  const createTask = useCreateTask()
  const [title, setTitle] = useState('')
  const [domain, setDomain] = useState<TaskDomain>('home')
  const [when, setWhen] = useState<WhenKey>('none')
  const [customAt, setCustomAt] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')

  // Reset on every open. A sheet that reopens holding the last matter's title
  // is one distracted tap away from creating it twice.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDomain('home')
    setWhen('none')
    setCustomAt('')
    setPriority('normal')
  }, [open])

  // "Pick a date" with nothing picked yet is not a date. Saving then would
  // silently file the matter as undated, which is the one outcome the user
  // demonstrably did not want when they tapped that chip.
  const dueMissing = when === 'custom' && !customAt

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed || dueMissing || createTask.isPending) return
    createTask.mutate(
      {
        title: trimmed,
        domain,
        priority,
        // A dated matter is a promise to fire; an undated one is a note. The
        // server enforces that a reminder carries a date, so the kind follows
        // the date rather than being a third thing to choose.
        kind: when === 'none' ? 'list' : 'reminder',
        dueAt: resolveDue(when, customAt, new Date()),
      },
      {
        onSuccess: () => {
          toast.success('Added.')
          onClose()
        },
        onError: (err) => toast.error(translateBackendError(err, "That didn't save.")),
      },
    )
  }

  return (
    <MorphSheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title="New matter"
      eyebrow="Add by hand"
      height={520}
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!title.trim() || dueMissing || createTask.isPending}
          onClick={submit}
        >
          {createTask.isPending ? 'Saving…' : 'Add matter'}
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          autoFocus
          placeholder="What needs doing?"
          aria-label="Matter title"
          enterKeyHint="done"
          // A matter title is prose, not a form field the browser has ever
          // seen before — offering saved addresses and card names over it is
          // noise sitting directly on top of the area picker.
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        <SheetSection label="Area">
          <div className="flex flex-wrap gap-2">
            {TASK_DOMAINS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDomain(d)}
                aria-pressed={domain === d}
                className={cn(
                  'flex items-center gap-2 rounded-pill py-1.5 pl-1.5 pr-3.5 text-body-sm font-bold transition-colors',
                  domain === d ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink',
                )}
              >
                <DomainIcon domain={d} size={28} />
                {DOMAIN_LABEL[d]}
              </button>
            ))}
          </div>
        </SheetSection>

        <SheetSection label="When">
          <div className="flex flex-wrap gap-2">
            {WHEN.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => setWhen(w.key)}
                aria-pressed={when === w.key}
                className={cn(
                  'rounded-pill px-3.5 py-2 text-body-sm font-bold transition-colors',
                  when === w.key ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink-muted',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>

          {when === 'custom' ? (
            <Input
              type="datetime-local"
              value={customAt}
              onChange={(e) => setCustomAt(e.target.value)}
              aria-label="Due date and time"
              className="mt-1"
            />
          ) : null}
        </SheetSection>

        <SheetSection label="Priority">
          <div className="flex flex-wrap gap-2">
            {PRIORITIES.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                aria-pressed={priority === p.value}
                className={cn(
                  'rounded-pill px-3.5 py-2 text-body-sm font-bold transition-colors',
                  priority === p.value
                    ? 'bg-accent text-accent-ink'
                    : 'bg-surface-field text-ink-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </SheetSection>
      </div>
    </MorphSheet>
  )
}
