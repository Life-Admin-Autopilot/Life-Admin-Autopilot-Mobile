'use client'

// Editing a filed matter, in a bottom sheet that morphs out of the Edit button
// that opened it.
//
// This used to expand inline inside the row. Two things were wrong with that:
// the form pushed every row below it down the page, so the thing you were
// editing jumped away from your finger as the fields appeared; and a ~100-line
// form nested two levels inside a list item left the list component owning
// state that had nothing to do with listing. A sheet is a mode — it should look
// like one.
//
// Draft state lives HERE, not in the caller. The caller says "edit this
// candidate"; this component owns the in-progress edit and hands back a
// finished draft on save, so an abandoned edit cannot leak into the list.

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DOMAINS, usePriorityLabels } from '@/components/scan/candidateDisplay'
import { useDomainLabels } from '@/hooks/useDomainLabels'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { fromLocalInputValue, toLocalInputValue } from '@/lib/taskFormat'
import type { ScanCandidateDomain, ScanCandidatePriority } from '@/queries/documentScans'

export interface CandidateDraft {
  title: string
  domain: ScanCandidateDomain
  priority: ScanCandidatePriority
  dueAt?: string
  notes?: string
}

const PRIORITIES: ScanCandidatePriority[] = ['low', 'normal', 'high', 'urgent']

export function CandidateEditSheet({
  open,
  candidateKey,
  initial,
  trigger,
  pending,
  failed,
  onSave,
  onClose,
}: {
  open: boolean
  /** Identity of the candidate being edited — reseeds the draft when it changes. */
  candidateKey: string | null
  initial: CandidateDraft | null
  trigger?: DOMRect | null
  pending: boolean
  failed: boolean
  onSave: (draft: CandidateDraft) => void
  onClose: () => void
}) {
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const domainLabels = useDomainLabels()
  const priorityLabels = usePriorityLabels()
  const [draft, setDraft] = useState<CandidateDraft | null>(initial)
  // Reseed on open, and whenever a DIFFERENT candidate is opened. Doing it in
  // render rather than an effect means the sheet never paints one frame of the
  // previous candidate's values as it grows out of the button.
  const [seededFor, setSeededFor] = useState<string | null>(null)
  if (open && candidateKey && seededFor !== candidateKey) {
    setSeededFor(candidateKey)
    setDraft(initial)
  }
  if (!open && seededFor !== null) setSeededFor(null)

  const patch = (next: Partial<CandidateDraft>) => setDraft((d) => (d ? { ...d, ...next } : d))

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={560}
      eyebrow={t('edit.eyebrow')}
      title={draft?.title.trim() || t('edit.untitled')}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="flex items-center gap-1 rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
          >
            <X size={14} />
            {tCommon('cancel')}
          </button>
          <Button
            variant="default"
            className="h-8 gap-1 px-3 text-caption"
            disabled={pending || !draft?.title.trim()}
            onClick={() => draft && onSave(draft)}
          >
            <Check size={14} />
            {pending ? tCommon('saving') : tCommon('save')}
          </Button>
        </div>
      }
    >
      {draft ? (
        <div className="flex flex-col gap-4 pt-1">
          <Field label={t('fields.title')}>
            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              dir="auto"
              className="w-full rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none focus:ring-2 focus:ring-accent/40"
            />
          </Field>

          <Field label={t('fields.domain')}>
            <div className="flex flex-wrap gap-1.5">
              {DOMAINS.map((d) => (
                <Chip key={d} active={draft.domain === d} onClick={() => patch({ domain: d })}>
                  {domainLabels[d]}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label={t('fields.priority')}>
            <div className="flex flex-wrap gap-1.5">
              {PRIORITIES.map((p) => (
                <Chip key={p} active={draft.priority === p} onClick={() => patch({ priority: p })}>
                  {priorityLabels[p]}
                </Chip>
              ))}
            </div>
          </Field>

          <Field label={t('fields.due')}>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={toLocalInputValue(draft.dueAt)}
                onChange={(e) => patch({ dueAt: fromLocalInputValue(e.target.value) })}
                className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none focus:ring-2 focus:ring-accent/40"
              />
              {draft.dueAt ? (
                <button
                  type="button"
                  onClick={() => patch({ dueAt: undefined })}
                  className="shrink-0 text-caption text-ink-subtle hover:text-ink"
                >
                  {tCommon('clear')}
                </button>
              ) : null}
            </div>
          </Field>

          <Field label={t('fields.summary')}>
            <textarea
              value={draft.notes ?? ''}
              onChange={(e) => patch({ notes: e.target.value })}
              dir="auto"
              className="min-h-24 w-full rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none focus:ring-2 focus:ring-accent/40"
            />
          </Field>

          {failed ? <p className="text-caption text-danger">{t('edit.saveFailed')}</p> : null}
        </div>
      ) : null}
    </Sheet>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-label uppercase text-ink-subtle">{label}</span>
      {children}
    </label>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-pill border px-2.5 py-1 text-caption transition-colors',
        active
          ? 'border-accent bg-accent/10 text-ink'
          : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  )
}
