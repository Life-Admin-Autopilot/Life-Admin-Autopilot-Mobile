'use client'

// Full-bleed list row for /documents.
//
// Shape: [type tile] [title / subtitle] [time], with the unresolved dot badged
// onto the tile rather than given a column. Each row is its own soft
// white card separated by whitespace — no dividers — so the eye runs down the
// titles instead of stopping at eleven borders.
//
// Proportions are deliberately generous: a 48px tile and an 18px title, not a
// dense 14px settings row. This screen is a small number of documents the user
// scans occasionally, so it should read like a library, not a log.
//
// Both text lines truncate. A document's title and subtitle are AI-written and
// therefore unbounded in practice; a row that reflows to three lines because
// one scan produced a wordy subtitle destroys the rhythm of the whole list.
// `min-w-0` on the text column is what actually lets `truncate` engage inside
// a flex row — without it the column refuses to shrink below its content.

import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DocumentTypeIcon } from '@/components/scan/DocumentTypeIcon'
import { SelectionCheck } from '@/components/ui/CompletionRing'
import { cn } from '@/lib/cn'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatScanTime } from '@/lib/scanTime'
import { useLongPress } from '@/lib/useLongPress'
import type { ScannedDocument } from '@/queries/documentScans'

// These are plain functions, not hooks, so they take the translator as an
// argument — the shape lib/i18n/translate.ts exists for, and the same idiom
// CalendarFeedsSheet uses for its two copy builders.
type ScanT = ReturnType<typeof useTranslations<'scan'>>

// One WHOLE sentence per source, not a noun spliced into a frame. The old
// `Reading your ${sourceLabel(doc).toLowerCase()}…` cannot survive translation:
// Arabic does not lowercase, "photo" takes a possessive suffix rather than a
// separate pronoun, and "PDF" stays Latin inside an RTL sentence. Splitting the
// frame per case is the only version a translator can actually write.
function readingTitle(doc: ScannedDocument, t: ScanT): string {
  if (doc.sourceType === 'pdf') return t('row.readingPdf')
  if (doc.sourceType === 'gallery') return t('row.readingPhoto')
  return t('row.readingScan')
}

function scanTitle(doc: ScannedDocument, t: ScanT): string {
  if (doc.sourceType === 'pdf') return t('row.titlePdf')
  if (doc.sourceType === 'gallery') return t('row.titlePhoto')
  return t('row.titleScan')
}

// A document is unresolved while it is still being read, has failed, or holds
// a candidate the user hasn't accepted or discarded. This used to split the
// list into Waiting/Filed sections; as a per-row dot it says the same thing
// without cutting the list in two.
export function isUnresolved(doc: ScannedDocument): boolean {
  if (doc.status === 'pending' || doc.status === 'processing') return true
  if (doc.status === 'failed') return true
  return doc.candidates.some((c) => !c.taskId)
}

interface RowCopy {
  title: string
  subtitle: string
  tone: 'normal' | 'muted' | 'danger'
}

// Falls back through documentTitle -> documentSummary -> source label. The
// middle rung is what every document scanned before the row-copy fields existed
// lands on — a stale row shows a long summary rather than nothing at all.
function resolveCopy(doc: ScannedDocument, t: ScanT): RowCopy {
  const pending = doc.candidates.filter((c) => !c.taskId).length

  if (doc.status === 'pending' || doc.status === 'processing') {
    return {
      title: readingTitle(doc, t),
      subtitle: t('row.readingSubtitle'),
      tone: 'muted',
    }
  }

  if (doc.status === 'failed') {
    return {
      title: t('row.failedTitle'),
      subtitle: doc.failureReason ?? t('row.failedSubtitle'),
      tone: 'danger',
    }
  }

  const title =
    doc.documentTitle ??
    doc.documentSummary ??
    (doc.candidates.length === 1 ? doc.candidates[0].title : scanTitle(doc, t))

  // The subtitle slot is the row's one line of detail, so what belongs there
  // depends on whether the user still owes the document something. An unhandled
  // candidate count outranks the document's own description — that is the whole
  // reason this row is worth tapping.
  if (pending > 0) {
    const review = t('row.toReview', { count: pending })
    return {
      title,
      subtitle: doc.issuer ? `${review} · ${doc.issuer}` : review,
      tone: 'normal',
    }
  }

  // "Nothing actionable" belongs in the SUBTITLE, not the title. Putting it in
  // the title threw away the document's own name — a scan the user can no
  // longer identify is worse than one they know produced no matters.
  if (doc.candidates.length === 0) {
    return {
      title,
      subtitle: doc.documentSubtitle ?? t('row.nothingActionable'),
      tone: 'muted',
    }
  }

  return {
    title,
    subtitle: doc.documentSubtitle ?? doc.issuer ?? t('row.filed'),
    tone: 'normal',
  }
}

const TITLE_TONE: Record<RowCopy['tone'], string> = {
  normal: 'text-ink',
  muted: 'text-ink-muted',
  danger: 'text-danger',
}

export function DocumentRow({
  doc,
  selectable = false,
  selected = false,
  onOpen,
  onToggleSelect,
  onLongPress,
}: {
  doc: ScannedDocument
  selectable?: boolean
  selected?: boolean
  onOpen: () => void
  onToggleSelect: () => void
  /** Enters selection mode with this row already picked. */
  onLongPress?: () => void
}) {
  const t = useTranslations('scan')
  const tLib = useTranslations('lib')
  const intlTag = useIntlTag()
  const busy = doc.status === 'pending' || doc.status === 'processing'
  const unresolved = isUnresolved(doc)
  const { title, subtitle, tone } = resolveCopy(doc, t)

  // Press-and-hold is the only way into selection mode — the header has no
  // Select button. Pointer events (not touch) so it works with a mouse too.
  const press = useLongPress(onLongPress, selectable)

  return (
    <button
      type="button"
      onClick={() => {
        if (press.consumeClick()) return
        if (selectable) onToggleSelect()
        else onOpen()
      }}
      {...press.handlers}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        'relative flex w-full select-none items-center gap-3.5 rounded-2xl py-3 pe-4 text-start shadow-card transition-colors',
        selectable ? 'ps-3' : 'ps-4',
        selected ? 'bg-accent-soft' : 'bg-surface',
      )}
    >
      {/* Selection gets a column of its own — the checkbox is the thing being
          acted on, so it earns the space, and the shift only happens on an
          explicit mode change the user just asked for. */}
      {selectable ? (
        <SelectionCheck checked={selected} size={24} />
      ) : null}

      {/* The unresolved marker BADGES THE TILE rather than getting a column or
          floating in the page gutter. A reserved 18px column plus a gap pushed
          every row 30px inward to make space for a marker most rows never show;
          hanging the dot off the card's left edge instead cost nothing but read
          as a stray speck in the margin, unattached to anything. On the tile it
          is unmistakably about THIS document, the way an unread badge is, and
          still costs no layout. The ring in the card colour keeps it legible
          over whichever pastel the type happens to be. */}
      <span className="relative shrink-0">
        <DocumentTypeIcon type={doc.documentType} size={48} />
        {!selectable && unresolved ? (
          <span
            aria-hidden
            className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
          />
        ) : null}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-heading-sm', TITLE_TONE[tone])}>
            {title}
          </span>
          <span className="shrink-0 text-caption tabular text-ink-subtle">
            {formatScanTime(doc.createdAt, { t: tLib, tag: intlTag })}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {busy ? (
            <Loader2 size={13} className="shrink-0 animate-spin text-ink-subtle" />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-body-sm text-ink-subtle">{subtitle}</span>
        </span>
      </span>
    </button>
  )
}
