'use client'

// Groups the /documents list by whether the scan still needs something from
// you. A flat list mixed "1 to review" rows in among already-filed history, so
// the one thing you actually have to act on was indistinguishable from the
// seven you'd already handled.
//
// WAITING  — anything unresolved: still processing, failed, or holding at least
//            one candidate the user hasn't confirmed/discarded yet.
// FILED    — every candidate handled, or the scan had nothing actionable.
//
// Both groups always render in full; the header is a label, not a control.

import { useRef } from 'react'

import { DocumentRow } from '@/components/scan/DocumentRow'
import type { ScannedDocument } from '@/queries/documentScans'

export function isWaitingOnUser(doc: ScannedDocument): boolean {
  // A scan mid-flight is waiting on *us*, not the user, but it is still
  // unresolved — filing it away under history would hide it as it lands.
  if (doc.status === 'pending' || doc.status === 'processing') return true
  if (doc.status === 'failed') return true
  return doc.candidates.some((c) => !c.taskId)
}

export function DocumentSections({
  docs,
  onOpen,
}: {
  docs: ScannedDocument[]
  onOpen: (doc: ScannedDocument, rect: DOMRect) => void
}) {
  const waiting = docs.filter(isWaitingOnUser)
  const filed = docs.filter((d) => !isWaitingOnUser(d))

  return (
    <div className="flex flex-col gap-6">
      {waiting.length > 0 ? (
        <DocumentGroup label="Waiting" docs={waiting} onOpen={onOpen} />
      ) : null}
      {filed.length > 0 ? <DocumentGroup label="Filed" docs={filed} onOpen={onOpen} /> : null}
    </div>
  )
}

function DocumentGroup({
  label,
  docs,
  onOpen,
}: {
  label: string
  docs: ScannedDocument[]
  onOpen: (doc: ScannedDocument, rect: DOMRect) => void
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <span className="flex items-baseline gap-2">
        <span className="text-label uppercase text-accent">{label}</span>
        <span className="text-caption text-ink-subtle">{docs.length}</span>
      </span>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {docs.map((doc) => (
          <RowWithRect key={doc.id} doc={doc} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

// Captures its own row's rect on tap so DocumentCaptureFlow can grow the morph
// shell from wherever this particular row sits in the list, exactly like
// OnboardingIsland captures its island's rect for IslandHandoff.
function RowWithRect({
  doc,
  onOpen,
}: {
  doc: ScannedDocument
  onOpen: (doc: ScannedDocument, rect: DOMRect) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref}>
      <DocumentRow
        doc={doc}
        onOpen={() => ref.current && onOpen(doc, ref.current.getBoundingClientRect())}
      />
    </div>
  )
}
