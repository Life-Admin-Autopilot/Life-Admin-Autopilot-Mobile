'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { AmountField } from '@/components/matters/AmountField'

import { useDomainLabels } from '@/hooks/useDomainLabels'
import { DomainIcon } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MorphSheet, SheetSection } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { fromLocalInputValue } from '@/lib/taskFormat'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import {
  TASK_DOMAINS,
  TASK_PRIORITIES,
  useCreateTask,
  type TaskDomain,
  type TaskPriority,
  type MoneyInput,
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

// The priority chips read TASK_PRIORITIES and `matters.priority.*` directly —
// the four labels already exist for the filter sheet and the editor, and a
// module-level Record here could not call useTranslations anyway.

/** Relative offsets, resolved against `now` at save time.
 *
 *  `labelKey` is a catalogue path, not a string: four of the five chips say
 *  something the catalogue already says elsewhere (the undated label, two time
 *  buckets, a snooze preset), so this points at them rather than adding five
 *  more keys. Typed as a literal union so `t(labelKey)` resolves at compile
 *  time — same reason as SnoozePreset.labelKey in lib/taskFormat.ts. */
const WHEN = [
  { key: 'none', labelKey: 'due.noDate' },
  { key: 'today', labelKey: 'bucket.today' },
  { key: 'tomorrow', labelKey: 'bucket.tomorrow' },
  { key: 'week', labelKey: 'snooze.nextWeek' },
  { key: 'custom', labelKey: 'create.pickDate' },
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
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  const tMoney = useTranslations('money')
  const domainLabels = useDomainLabels()
  const createTask = useCreateTask()
  const [title, setTitle] = useState('')
  const [domain, setDomain] = useState<TaskDomain>('home')
  const [when, setWhen] = useState<WhenKey>('none')
  const [customAt, setCustomAt] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [amount, setAmount] = useState<MoneyInput | null>(null)

  // Reset on every open. A sheet that reopens holding the last matter's title
  // is one distracted tap away from creating it twice.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setDomain('home')
    setWhen('none')
    setCustomAt('')
    setPriority('normal')
    setAmount(null)
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
        // Omitted entirely when nothing was typed. Sending a zero would put
        // the matter on the money page claiming it cost nothing.
        ...(amount ? { amount } : {}),
      },
      {
        onSuccess: () => {
          toast.success(t('create.added'))
          onClose()
        },
        onError: (err) => toast.error(translateBackendError(err, tCommon('notSaved'))),
      },
    )
  }

  return (
    <MorphSheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title={t('create.title')}
      eyebrow={t('create.eyebrow')}
      height={520}
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={!title.trim() || dueMissing || createTask.isPending}
          onClick={submit}
        >
          {createTask.isPending ? tCommon('saving') : t('create.submit')}
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
          placeholder={t('create.titlePlaceholder')}
          aria-label={t('create.titleLabel')}
          enterKeyHint="done"
          // A matter title is prose, not a form field the browser has ever
          // seen before — offering saved addresses and card names over it is
          // noise sitting directly on top of the area picker.
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        <SheetSection label={t('section.area')}>
          <div className="flex flex-wrap gap-2">
            {TASK_DOMAINS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDomain(d)}
                aria-pressed={domain === d}
                className={cn(
                  'flex items-center gap-2 rounded-pill py-1.5 ps-1.5 pe-3.5 text-body-sm font-bold transition-colors',
                  domain === d ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink',
                )}
              >
                <DomainIcon domain={d} size={28} />
                {domainLabels[d]}
              </button>
            ))}
          </div>
        </SheetSection>

        <SheetSection label={t('section.when')}>
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
                {t(w.labelKey)}
              </button>
            ))}
          </div>

          {when === 'custom' ? (
            <Input
              type="datetime-local"
              value={customAt}
              onChange={(e) => setCustomAt(e.target.value)}
              aria-label={t('create.dueLabel')}
              className="mt-1"
            />
          ) : null}
        </SheetSection>

        <SheetSection label={t('section.priority')}>
          <div className="flex flex-wrap gap-2">
            {TASK_PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                aria-pressed={priority === p}
                className={cn(
                  'rounded-pill px-3.5 py-2 text-body-sm font-bold transition-colors',
                  priority === p ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink-muted',
                )}
              >
                {t(`priority.${p}`)}
              </button>
            ))}
          </div>
        </SheetSection>

        {/* Last, and optional. Most matters are not about money, so asking for a
            figure above the date would imply otherwise on every one of them. */}
        <SheetSection label={tMoney('field.label')}>
          <AmountField value={amount} onChange={setAmount} />
        </SheetSection>
      </div>
    </MorphSheet>
  )
}
