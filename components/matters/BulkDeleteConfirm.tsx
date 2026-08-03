'use client'

import { AlertTriangle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDue, formatRange } from '@/lib/taskFormat'
import type { BulkPreview, TaskFilters } from '@/queries/tasks'
import { Sheet } from '@/components/ui/Sheet'

// The confirm gate for a bulk delete.
//
// Three things this must do, all of them learned from how bulk deletes go
// wrong:
//   1. Show the range as ABSOLUTE dates. The user said "last month"; the app
//      must say "Jun 25 – Jul 25, 2026" before anything happens.
//   2. Show the exact count, and let the user actually look at the list.
//   3. Disclose ripple effects — matters that came from a scanned document, and
//      ones whose reminder already fired. Those are commitments the user was
//      notified about, not silent backlog, and deleting them is a bigger deal
//      than the raw number suggests.
//
// The delete is recoverable, and the copy says so. Overstating the danger of a
// reversible action trains people to ignore the warnings that matter.

export function BulkDeleteConfirm({
  open,
  preview,
  filters,
  trigger,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean
  preview: BulkPreview | null
  // Present when the delete came from a date range rather than a selection.
  filters?: TaskFilters
  trigger?: DOMRect | null
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  const tag = useIntlTag()
  const [showAll, setShowAll] = useState(false)

  // The caller clears `preview` on the same tick it closes this, so hold the
  // last one through the collapse. Otherwise the title flips to "Delete 0
  // matters?" and the list empties while the sheet is still on screen, which
  // reads as the sheet breaking rather than receding.
  const [held, setHeld] = useState(preview)
  if (preview && preview !== held) setHeld(preview)
  const shown = preview ?? held

  const count = shown?.count ?? 0
  const warnings = shown?.warnings
  const ranged = Boolean(filters?.dueAfter || filters?.dueBefore)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={showAll ? 560 : 340}
      eyebrow={tCommon('canBeUndone')}
      title={t('bulkDelete.title', { count })}
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
            {pending ? t('bulkDelete.deleting') : t('bulkDelete.confirm', { count })}
          </Button>
        </div>
      }
    >
      {ranged ? (
        <p className="text-body-sm text-ink">
          <span className="tabular font-medium">
            {formatRange(filters?.dueAfter, filters?.dueBefore, { t, tag })}
          </span>
          <span className="text-ink-subtle"> · {t('bulkDelete.resolvedDates')}</span>
        </p>
      ) : null}

      {warnings && (warnings.fromDocuments > 0 || warnings.remindersFired > 0) ? (
        <ul className="mt-3 flex flex-col gap-1.5 rounded-md bg-warning-soft px-3 py-2.5">
          {warnings.fromDocuments > 0 ? (
            <li className="flex items-start gap-2 text-caption text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t.rich('bulkDelete.fromDocuments', {
                  count: warnings.fromDocuments,
                  b: (chunks: React.ReactNode) => (
                    <span className="tabular font-medium">{chunks}</span>
                  ),
                })}
              </span>
            </li>
          ) : null}
          {warnings.remindersFired > 0 ? (
            <li className="flex items-start gap-2 text-caption text-warning">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t.rich('bulkDelete.remindersFired', {
                  count: warnings.remindersFired,
                  b: (chunks: React.ReactNode) => (
                    <span className="tabular font-medium">{chunks}</span>
                  ),
                })}
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-caption text-accent"
        >
          {showAll
            ? t('bulkDelete.hide')
            : t('bulkDelete.preview', { count: Math.min(count, shown?.sample.length ?? 0) })}
        </button>
        {showAll ? (
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
            {shown?.sample.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <span className="truncate text-body-sm text-ink">{task.title}</span>
                <span className="shrink-0 text-caption tabular text-ink-subtle">
                  {formatDue(task.dueAt, { t, tag })}
                </span>
              </li>
            ))}
            {count > (shown?.sample.length ?? 0) ? (
              <li className="px-3 py-2 text-caption text-ink-subtle">
                {t('bulkDelete.andMore', { count: count - (shown?.sample.length ?? 0) })}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>

      <p className="mt-4 text-caption text-ink-subtle">{t('bulkDelete.recoverable')}</p>
    </Sheet>
  )
}
