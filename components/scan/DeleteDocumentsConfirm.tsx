'use client'

import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/Sheet'
import { formatScanTime } from '@/lib/scanTime'
import type { ScannedDocument } from '@/queries/documentScans'

// The confirm gate for deleting scanned documents.
//
// Unlike the matters bulk delete, this one is NOT recoverable — deleting
// destroys the stored original, and there is no trash to fish it back out of.
// The eyebrow says so plainly, because the single worst thing this sheet could
// do is borrow the reassuring copy from the delete that *is* reversible.
//
// It also discloses the ripple the count alone hides: documents still holding
// unreviewed items are about to lose those items unread, and matters already
// filed from these documents will survive. Both are things people assume the
// opposite of.

export function DeleteDocumentsConfirm({
  open,
  docs,
  trigger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean
  docs: ScannedDocument[]
  trigger?: DOMRect | null
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [showAll, setShowAll] = useState(false)

  // The caller clears the selection on the same tick it closes this, so hold
  // the last non-empty set through the collapse — otherwise the title flips to
  // "Delete 0 documents?" while the sheet is still on screen, which reads as
  // the sheet breaking rather than receding.
  const [held, setHeld] = useState(docs)
  if (docs.length > 0 && docs !== held) setHeld(docs)
  const shown = docs.length > 0 ? docs : held

  const count = shown.length
  const unreviewed = shown.reduce(
    (n, doc) => n + doc.candidates.filter((c) => !c.taskId).length,
    0,
  )
  const filed = shown.reduce((n, doc) => n + doc.candidates.filter((c) => c.taskId).length, 0)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={showAll ? 540 : unreviewed > 0 ? 330 : 260}
      eyebrow="This cannot be undone"
      eyebrowTone="danger"
      title={count === 1 ? 'Delete 1 document?' : `Delete ${count} documents?`}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            Cancel
          </button>
          <Button
            className="h-8 gap-1 bg-danger px-4 text-caption text-accent-ink hover:bg-danger/90"
            disabled={pending || count === 0}
            onClick={onConfirm}
          >
            {pending ? 'Deleting…' : `Delete ${count}`}
          </Button>
        </div>
      }
    >
      <p className="text-body-sm text-ink">
        The original {count === 1 ? 'scan' : 'scans'} will be permanently removed.
      </p>

      {unreviewed > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 rounded-md bg-warning-soft px-3 py-2.5">
          <li className="flex items-start gap-2 text-caption text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              <span className="tabular font-medium">{unreviewed}</span>{' '}
              {unreviewed === 1 ? 'item has' : 'items have'} not been reviewed yet and will be lost.
            </span>
          </li>
        </ul>
      ) : null}

      {filed > 0 ? (
        <p className="mt-3 text-caption text-ink-subtle">
          <span className="tabular">{filed}</span>{' '}
          {filed === 1 ? 'matter' : 'matters'} already filed from{' '}
          {count === 1 ? 'this document' : 'these documents'} will stay in your list.
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-caption text-accent"
        >
          {showAll ? 'Hide' : `Preview ${count}`}
        </button>
        {showAll ? (
          <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl bg-surface-sunken">
            {shown.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="truncate text-body-sm text-ink">
                  {doc.documentTitle ?? doc.documentSummary ?? 'Untitled scan'}
                </span>
                <span className="shrink-0 text-caption tabular text-ink-subtle">
                  {formatScanTime(doc.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sheet>
  )
}
