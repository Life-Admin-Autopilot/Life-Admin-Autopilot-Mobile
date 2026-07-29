'use client'

// Read-only summary of what a document turned into, shown for the 'filed'
// phase — every remaining candidate on a filed doc already carries a taskId
// (the review endpoint drops discarded ones from `candidates` entirely), so
// this is exactly the created tasks, no separate fetch needed.
//
// Rows expand on tap; each has its own Edit affordance, which opens
// CandidateEditSheet and PATCHes the real Task (queries/tasks.ts) — NOT the
// review endpoint, which only works pre-accept. Edits are held in local
// `overrides` since ScannedDocument's candidate snapshot is never re-synced
// from Task edits.

import { useState } from 'react'
import { ChevronDown, Pencil } from 'lucide-react'

import { SketchDomainIcon } from '@/components/icons/sketch/domainGlyphs'
import { CandidateEditSheet, type CandidateDraft } from '@/components/scan/CandidateEditSheet'
import { formatDue, PriorityPill, SummaryNote } from '@/components/scan/candidateDisplay'
import { OriginalDocumentPeek } from '@/components/scan/OriginalDocumentPeek'
import { cn } from '@/lib/cn'
import { env } from '@/lib/env'
import { useUpdateTask, type UpdateTaskBody } from '@/queries/tasks'
import type { ScanCandidate, ScannedDocument } from '@/queries/documentScans'

export function TaskOverview({ doc }: { doc: ScannedDocument }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ key: string; rect: DOMRect } | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Partial<CandidateDraft>>>({})
  const updateTask = useUpdateTask()

  if (doc.candidates.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-body font-medium text-ink">Nothing was filed from this scan.</p>
        <p className="text-caption text-ink-subtle">{env.appName} didn&apos;t find anything actionable here.</p>
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

  const editingCandidate = editing ? doc.candidates.find((c) => c.key === editing.key) : undefined

  const saveEdit = (draft: CandidateDraft) => {
    const c = editingCandidate
    if (!c?.taskId) return
    const original = displayFor(c)
    // Only changed fields go in the PATCH — sending the whole draft would
    // rewrite fields the user never touched, and stamp `notes: null` onto a
    // task whose summary was simply left alone.
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
          setEditing(null)
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
        <ul className="flex flex-col gap-2">
          {doc.candidates.map((c) => {
          const display = displayFor(c)
          const due = formatDue(display.dueAt)
          const isExpanded = expanded === c.key

          return (
            <li key={c.key} className="px-3.5 py-3">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : c.key)}
                className="flex w-full items-center gap-3 text-start"
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

              {isExpanded ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                  {c.sourcePage ? <span className="text-caption text-ink-muted">Found on page {c.sourcePage}</span> : null}
                  {display.notes ? (
                    <SummaryNote text={display.notes} />
                  ) : (
                    <span className="text-caption text-ink-subtle">Nothing more {env.appName} found here.</span>
                  )}
                  {c.taskId ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        setEditing({ key: c.key, rect: e.currentTarget.getBoundingClientRect() })
                      }}
                      className="flex items-center gap-1.5 self-start text-caption font-medium text-accent hover:underline"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
        </ul>
      </div>

      {/* Rendered once for the whole list, not per row. A sheet is a screen-level
          surface — mounting one inside every <li> would put N copies of a
          fullscreen overlay in the tree to show at most one. */}
      <CandidateEditSheet
        open={Boolean(editing)}
        candidateKey={editing?.key ?? null}
        initial={editingCandidate ? displayFor(editingCandidate) : null}
        trigger={editing?.rect ?? null}
        pending={updateTask.isPending}
        failed={updateTask.isError}
        onSave={saveEdit}
        onClose={() => setEditing(null)}
      />
    </div>
  )
}
