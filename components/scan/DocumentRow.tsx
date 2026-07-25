'use client'

// Status-aware list row for the base /documents page. Every row opens the
// same fullscreen morph flow, regardless of status. Rows are plain (no own
// border/shadow) — the parent wraps the whole list in one shared card with
// divide-y, per-row hairlines instead of a stack of individually-boxed
// cards. Standard lucide-icon list chrome (matches MatterRow's convention) —
// the hand-drawn sketch set is scoped to the fullscreen flow itself.

import { ChevronRight, Loader2 } from 'lucide-react'

import type { ScannedDocument } from '@/queries/documentScans'

function sourceLabel(doc: ScannedDocument): string {
  if (doc.sourceType === 'pdf') return 'PDF'
  if (doc.sourceType === 'gallery') return 'Photo'
  return 'Scan'
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Prefer the AI-written document summary as the row's title over a generic
// status word — falls back to the one candidate's own title, then a plain
// count, then the source type, in decreasing order of informativeness.
function documentLabel(doc: ScannedDocument): string {
  if (doc.documentSummary) return doc.documentSummary
  if (doc.candidates.length === 1) return doc.candidates[0].title
  if (doc.candidates.length > 1) return `${doc.candidates.length} matters`
  return `${sourceLabel(doc)} scan`
}

export function DocumentRow({ doc, onOpen }: { doc: ScannedDocument; onOpen: () => void }) {
  const pending = doc.candidates.filter((c) => !c.taskId).length
  const isBusy = doc.status === 'pending' || doc.status === 'processing'

  let title: string
  let subtitle: string
  let titleClassName = 'text-body-sm font-medium text-ink'

  if (isBusy) {
    title = `Reading your ${sourceLabel(doc).toLowerCase()}…`
    subtitle = formatWhen(doc.createdAt)
  } else if (doc.status === 'failed') {
    title = "Couldn't process this scan"
    titleClassName = 'text-body-sm font-medium text-danger'
    subtitle = doc.failureReason ?? 'Tap to see what happened.'
  } else if (pending > 0) {
    title = documentLabel(doc)
    subtitle = `${pending === 1 ? '1 to review' : `${pending} to review`} · ${formatWhen(doc.createdAt)}`
  } else if (doc.candidates.length === 0) {
    title = 'Nothing actionable found'
    titleClassName = 'text-body-sm font-medium text-ink-muted'
    subtitle = formatWhen(doc.createdAt)
  } else {
    title = documentLabel(doc)
    subtitle = `Filed · ${formatWhen(doc.createdAt)}`
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-sunken"
    >
      {isBusy ? <Loader2 size={16} className="shrink-0 animate-spin text-ink-subtle" /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={`${titleClassName} truncate`}>{title}</span>
        <span className="truncate text-caption text-ink-subtle">{subtitle}</span>
      </div>
      <ChevronRight size={16} className="shrink-0 text-ink-subtle" />
    </button>
  )
}
