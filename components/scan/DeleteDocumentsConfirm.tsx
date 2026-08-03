'use client'

import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/Sheet'
import { useIntlTag } from '@/lib/i18n/localeStore'
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
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const tLib = useTranslations('lib')
  const intlTag = useIntlTag()
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
      eyebrow={tCommon('cannotBeUndone')}
      eyebrowTone="danger"
      title={t('delete.title', { count })}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            {tCommon('cancel')}
          </button>
          <Button
            className="h-8 gap-1 bg-danger px-4 text-caption text-accent-ink hover:bg-danger/90"
            disabled={pending || count === 0}
            onClick={onConfirm}
          >
            {pending ? t('delete.deleting') : t('delete.confirm', { count })}
          </Button>
        </div>
      }
    >
      <p className="text-body-sm text-ink">{t('delete.originals', { count })}</p>

      {/* The counts used to be their own <span> so the digit could be bolder
          than the sentence around it. They are inside the ICU message now —
          Arabic puts the number in a different place in the sentence, and a
          number lifted out of the message is a number the translator cannot
          move. `tabular` moves to the whole line instead. */}
      {unreviewed > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 rounded-md bg-warning-soft px-3 py-2.5">
          <li className="flex items-start gap-2 text-caption text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="tabular">{t('delete.unreviewed', { count: unreviewed })}</span>
          </li>
        </ul>
      ) : null}

      {filed > 0 ? (
        <p className="mt-3 text-caption tabular text-ink-subtle">
          {t('delete.filedStay', { filed, count })}
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-caption text-accent"
        >
          {showAll ? t('delete.hide') : t('delete.preview', { count })}
        </button>
        {showAll ? (
          <ul className="mt-2 max-h-52 overflow-y-auto rounded-xl bg-surface-sunken">
            {shown.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="truncate text-body-sm text-ink">
                  {doc.documentTitle ?? doc.documentSummary ?? t('delete.untitledScan')}
                </span>
                <span className="shrink-0 text-caption tabular text-ink-subtle">
                  {formatScanTime(doc.createdAt, { t: tLib, tag: intlTag })}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Sheet>
  )
}
