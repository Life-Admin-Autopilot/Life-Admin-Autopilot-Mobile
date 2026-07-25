'use client'

// Read-only-by-default summary of what a document turned into, shown for the
// 'filed' phase — every remaining candidate on a filed doc already carries a
// taskId (the review endpoint drops discarded ones from `candidates`
// entirely), so this is exactly the created tasks, no separate fetch needed.
// Rows expand on tap; each has its own Edit affordance, which PATCHes the
// real Task (queries/tasks.ts) — NOT the review endpoint, which only works
// pre-accept. Edits are held in local `overrides` since ScannedDocument's
// candidate snapshot is never re-synced from Task edits.

import { useState } from 'react'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'

import { SketchDomainIcon } from '@/components/icons/sketch/domainGlyphs'
import { DOMAIN_LABEL, DOMAINS, formatDue, PriorityPill, SummaryNote } from '@/components/scan/candidateDisplay'
import { OriginalDocumentPeek } from '@/components/scan/OriginalDocumentPeek'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useUpdateTask, type UpdateTaskBody } from '@/queries/tasks'
import type { ScanCandidate, ScanCandidateDomain, ScanCandidatePriority, ScannedDocument } from '@/queries/documentScans'

const PRIORITIES: ScanCandidatePriority[] = ['low', 'normal', 'high', 'urgent']
const PRIORITY_CHIP_LABEL: Record<ScanCandidatePriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

function toLocalInputValue(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInputValue(v: string): string | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

interface CandidateDraft {
  title: string
  domain: ScanCandidateDomain
  priority: ScanCandidatePriority
  dueAt?: string
  notes?: string
}

export function TaskOverview({ doc }: { doc: ScannedDocument }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<CandidateDraft | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Partial<CandidateDraft>>>({})
  const updateTask = useUpdateTask()

  if (doc.candidates.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-body font-medium text-ink">Nothing was filed from this scan.</p>
        <p className="text-caption text-ink-subtle">Mo didn&apos;t find anything actionable here.</p>
      </div>
    )
  }

  const displayFor = (c: ScanCandidate): CandidateDraft => ({
    title: c.title,
    domain: c.domain,
    priority: c.priority,
    dueAt: c.dueAt,
    notes: c.notes,
    ...overrides[c.key],
  })

  const startEdit = (c: ScanCandidate) => {
    setEditingKey(c.key)
    setDraft(displayFor(c))
    setExpanded(c.key)
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setDraft(null)
  }

  const updateDraft = (patch: Partial<CandidateDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const saveEdit = (c: ScanCandidate) => {
    if (!draft || !c.taskId) return
    const original = displayFor(c)
    const body: UpdateTaskBody = {}
    if (draft.title.trim() && draft.title.trim() !== original.title) body.title = draft.title.trim()
    if (draft.domain !== original.domain) body.domain = draft.domain
    if (draft.priority !== original.priority) body.priority = draft.priority
    if (draft.dueAt !== original.dueAt) body.dueAt = draft.dueAt ?? null
    if ((draft.notes ?? '') !== (original.notes ?? '')) body.notes = draft.notes?.trim() || null

    updateTask.mutate(
      { taskId: c.taskId, body },
      {
        onSuccess: () => {
          setOverrides((prev) => ({ ...prev, [c.key]: { ...prev[c.key], ...draft } }))
          setEditingKey(null)
          setDraft(null)
        },
      },
    )
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3">
        <div>
          <h2 className="font-display text-heading-xl text-ink">
            {doc.candidates.length === 1 ? '1 matter filed' : `${doc.candidates.length} matters filed`}
          </h2>
        </div>
        {doc.documentSummary ? <SummaryNote text={doc.documentSummary} /> : null}
        <OriginalDocumentPeek doc={doc} />
      </div>

      {/* min-h-0 lets this shrink below its content size so overflow-y-auto
          actually scrolls instead of the parent stretching to fit — the <ul>
          itself is NOT flex-1, so a single row doesn't leave a huge empty
          stretched card underneath it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface shadow-card">
          {doc.candidates.map((c) => {
          const display = displayFor(c)
          const due = formatDue(display.dueAt)
          const isExpanded = expanded === c.key
          const isEditing = editingKey === c.key

          return (
            <li key={c.key} className="px-3.5 py-3">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : c.key)}
                className="flex w-full items-center gap-3 text-left"
              >
                <SketchDomainIcon domain={display.domain} size={22} className="shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm font-medium text-ink">{display.title}</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-caption tabular text-ink-muted">{due ?? 'No date set'}</span>
                    <PriorityPill priority={display.priority} />
                  </div>
                </div>
                <ChevronDown
                  size={15}
                  className={cn('shrink-0 text-ink-subtle transition-transform', isExpanded && 'rotate-180')}
                />
              </button>

              {isExpanded && !isEditing ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {c.sourcePage ? <span className="text-caption text-ink-muted">Found on page {c.sourcePage}</span> : null}
                  {display.notes ? (
                    <SummaryNote text={display.notes} />
                  ) : (
                    <span className="text-caption text-ink-subtle">Nothing more Mo found here.</span>
                  )}
                  {c.taskId ? (
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      className="flex items-center gap-1.5 self-start text-caption font-medium text-accent hover:underline"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isEditing && draft ? (
                <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                  <input
                    value={draft.title}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    dir="auto"
                    className="w-full rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none"
                  />

                  <div className="flex flex-wrap gap-1.5">
                    {DOMAINS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => updateDraft({ domain: d })}
                        className={cn(
                          'rounded-pill border px-2.5 py-1 text-caption transition-colors',
                          draft.domain === d
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
                        )}
                      >
                        {DOMAIN_LABEL[d]}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => updateDraft({ priority: p })}
                        className={cn(
                          'rounded-pill border px-2.5 py-1 text-caption transition-colors',
                          draft.priority === p
                            ? 'border-accent bg-accent/10 text-ink'
                            : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
                        )}
                      >
                        {PRIORITY_CHIP_LABEL[p]}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={toLocalInputValue(draft.dueAt)}
                      onChange={(e) => updateDraft({ dueAt: fromLocalInputValue(e.target.value) })}
                      className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none"
                    />
                    {draft.dueAt ? (
                      <button
                        type="button"
                        onClick={() => updateDraft({ dueAt: undefined })}
                        className="text-caption text-ink-subtle hover:text-ink"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-label uppercase text-ink-subtle">Summary</span>
                    <textarea
                      value={draft.notes ?? ''}
                      onChange={(e) => updateDraft({ notes: e.target.value })}
                      dir="auto"
                      className="min-h-24 rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none"
                    />
                  </div>

                  {updateTask.isError ? (
                    <p className="text-caption text-danger">Couldn&apos;t save that change. Try again.</p>
                  ) : null}

                  <div className="flex items-center gap-2 self-end">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={updateTask.isPending}
                      className="flex items-center gap-1 rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink disabled:opacity-50"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <Button
                      variant="default"
                      className="h-8 gap-1 px-3 text-caption"
                      disabled={updateTask.isPending || !draft.title.trim()}
                      onClick={() => saveEdit(c)}
                    >
                      <Check size={14} />
                      {updateTask.isPending ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
        </ul>
      </div>
    </div>
  )
}
