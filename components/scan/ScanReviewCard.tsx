'use client'

// The document flow's fullscreen 'review' phase content — one document's
// DRAFT candidates, presented for explicit accept/discard AND full field
// editing (title/domain/priority/due date/notes) before anything becomes a
// Task. Status branching (pending/processing/failed) lives one level up in
// DocumentCaptureFlow's phase machine — this component only ever renders
// once a doc is 'ready_for_review' with pending candidates.

import { useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'

import { SketchDomainIcon } from '@/components/icons/sketch/domainGlyphs'
import { DOMAIN_LABEL, DOMAINS, formatDue, PriorityPill, SummaryNote } from '@/components/scan/candidateDisplay'
import { OriginalDocumentPeek } from '@/components/scan/OriginalDocumentPeek'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { env } from '@/lib/env'
import {
  useReviewScannedDocument,
  type ReviewScanResult,
  type ScanCandidateDomain,
  type ScanCandidatePriority,
  type ScannedDocument,
} from '@/queries/documentScans'

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

interface ScanReviewCardProps {
  doc: ScannedDocument
  /** Fires with the review mutation's own response — the invalidated list
   *  cache alone can't tell "just reviewed" from "reviewed earlier," and
   *  discarded candidates don't produce tasks, so the success screen needs
   *  this exact payload rather than re-deriving a count from cache state. */
  onReviewed?: (result: ReviewScanResult) => void
}

export function ScanReviewCard({ doc, onReviewed }: ScanReviewCardProps) {
  const pending = doc.candidates.filter((c) => !c.taskId)
  const [discarded, setDiscarded] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, CandidateDraft>>(() =>
    Object.fromEntries(
      pending.map((c) => [
        c.key,
        { title: c.title, domain: c.domain, priority: c.priority, dueAt: c.dueAt, notes: c.notes },
      ]),
    ),
  )
  const review = useReviewScannedDocument(doc.id)

  if (pending.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-body font-medium text-ink">Nothing left to review here.</p>
        <p className="text-caption text-ink-subtle">Every item from this scan has already been handled.</p>
      </div>
    )
  }

  const draftFor = (key: string, fallback: (typeof pending)[number]): CandidateDraft =>
    drafts[key] ?? {
      title: fallback.title,
      domain: fallback.domain,
      priority: fallback.priority,
      dueAt: fallback.dueAt,
      notes: fallback.notes,
    }

  const updateDraft = (key: string, patch: Partial<CandidateDraft>) => {
    setDrafts((prev) => ({ ...prev, [key]: { ...draftFor(key, pending.find((c) => c.key === key)!), ...patch } }))
  }

  const toggleDiscard = (key: string) => {
    setDiscarded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const submit = () => {
    const accepts = pending
      .filter((c) => !discarded.has(c.key))
      .map((c) => {
        const d = draftFor(c.key, c)
        return {
          key: c.key,
          title: d.title.trim() || c.title,
          domain: d.domain,
          priority: d.priority,
          dueAt: d.dueAt,
          notes: d.notes?.trim() || undefined,
        }
      })
    const discards = pending.filter((c) => discarded.has(c.key)).map((c) => c.key)
    review.mutate({ accepts, discards }, { onSuccess: (result) => onReviewed?.(result) })
  }

  const allDiscarded = discarded.size === pending.length

  return (
    <div className="flex h-full flex-col gap-5 overflow-hidden">
      <div className="flex shrink-0 flex-col gap-5">
        <div>
          <span className="text-label text-accent">Review</span>
          <h2 className="font-display text-heading-xl text-ink">
            {pending.length === 1 ? '1 item found' : `${pending.length} items found`}
          </h2>
        </div>
        {doc.documentSummary ? <SummaryNote text={doc.documentSummary} /> : null}
        <OriginalDocumentPeek doc={doc} />
      </div>

      {/* min-h-0 lets this shrink below its content size inside the flex column
          so overflow-y-auto actually scrolls instead of the parent stretching
          to fit. The <ul> itself is NOT flex-1 — it only grows to its own
          content height, so a single short row doesn't leave a huge empty
          stretched card underneath it. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="flex flex-col gap-2">
          {pending.map((c) => {
            const isDiscarded = discarded.has(c.key)
            const isExpanded = expanded === c.key
            const draft = draftFor(c.key, c)
            const due = formatDue(draft.dueAt)
            return (
              <li key={c.key} className={cn('px-3.5 py-3 transition-opacity', isDiscarded && 'opacity-40')}>
                <div className="flex items-center gap-3">
                  <SketchDomainIcon domain={draft.domain} size={22} className="shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <input
                      value={draft.title}
                      onChange={(e) => updateDraft(c.key, { title: e.target.value })}
                      disabled={isDiscarded}
                      dir="auto"
                      className="w-full bg-transparent text-body-sm font-medium text-ink outline-none disabled:text-ink-subtle"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-caption tabular text-ink-muted">
                        {due ?? 'No date found'}
                        {c.confidence === 'low' ? ' · double-check this one' : ''}
                      </span>
                      <PriorityPill priority={draft.priority} />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : c.key)}
                    aria-label={isExpanded ? 'Collapse details' : 'Edit details'}
                    aria-expanded={isExpanded}
                    className="shrink-0 rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <ChevronDown size={15} className={cn('transition-transform', isExpanded && 'rotate-180')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleDiscard(c.key)}
                    aria-label={isDiscarded ? 'Keep this item' : 'Discard this item'}
                    className={cn(
                      'shrink-0 rounded-full p-1.5 transition-colors',
                      isDiscarded
                        ? 'text-ink-subtle hover:bg-surface-sunken'
                        : 'text-ink-subtle hover:bg-surface-sunken hover:text-danger',
                    )}
                  >
                    {isDiscarded ? <Check size={15} /> : <X size={15} />}
                  </button>
                </div>

                {isExpanded ? (
                  <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                    <div className="flex flex-wrap gap-1.5">
                      {DOMAINS.map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => updateDraft(c.key, { domain: d })}
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
                          onClick={() => updateDraft(c.key, { priority: p })}
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
                        onChange={(e) => updateDraft(c.key, { dueAt: fromLocalInputValue(e.target.value) })}
                        className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none"
                      />
                      {draft.dueAt ? (
                        <button
                          type="button"
                          onClick={() => updateDraft(c.key, { dueAt: undefined })}
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
                        onChange={(e) => updateDraft(c.key, { notes: e.target.value })}
                        placeholder={`What ${env.appName} found for this item…`}
                        dir="auto"
                        className="min-h-24 rounded-md bg-surface-sunken px-3 py-2 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      </div>

      <Button variant="solid" className="w-full shrink-0" disabled={review.isPending} onClick={submit}>
        {review.isPending ? 'Saving…' : allDiscarded ? 'Discard all' : 'Confirm'}
      </Button>
    </div>
  )
}
