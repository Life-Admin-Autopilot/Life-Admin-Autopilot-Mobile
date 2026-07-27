'use client'

// Full-bleed list row for /documents.
//
// Shape: [type tile] [title / subtitle] [time], with the unresolved dot floated
// into the left margin rather than given a column. Each row is its own soft
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

import { useCallback, useEffect, useRef } from 'react'
import { Loader2 } from 'lucide-react'

import { DocumentTypeIcon } from '@/components/scan/DocumentTypeIcon'
import { SelectionCheck } from '@/components/ui/CompletionRing'
import { cn } from '@/lib/cn'
import { formatScanTime } from '@/lib/scanTime'
import type { ScannedDocument } from '@/queries/documentScans'

const LONG_PRESS_MS = 450
// A press that wanders this far was a scroll, not a hold. Without it, dragging
// the list with a finger resting on a row arms selection mid-scroll.
const LONG_PRESS_SLOP_PX = 10

function sourceLabel(doc: ScannedDocument): string {
  if (doc.sourceType === 'pdf') return 'PDF'
  if (doc.sourceType === 'gallery') return 'Photo'
  return 'Scan'
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
function resolveCopy(doc: ScannedDocument): RowCopy {
  const pending = doc.candidates.filter((c) => !c.taskId).length

  if (doc.status === 'pending' || doc.status === 'processing') {
    return {
      title: `Reading your ${sourceLabel(doc).toLowerCase()}…`,
      subtitle: 'This usually takes a moment.',
      tone: 'muted',
    }
  }

  if (doc.status === 'failed') {
    return {
      title: "Couldn't read this document",
      subtitle: doc.failureReason ?? 'Tap to see what happened.',
      tone: 'danger',
    }
  }

  const title =
    doc.documentTitle ??
    doc.documentSummary ??
    (doc.candidates.length === 1 ? doc.candidates[0].title : `${sourceLabel(doc)} scan`)

  // The subtitle slot is the row's one line of detail, so what belongs there
  // depends on whether the user still owes the document something. An unhandled
  // candidate count outranks the document's own description — that is the whole
  // reason this row is worth tapping.
  if (pending > 0) {
    const review = pending === 1 ? '1 to review' : `${pending} to review`
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
      subtitle: doc.documentSubtitle ?? 'Nothing actionable found.',
      tone: 'muted',
    }
  }

  return {
    title,
    subtitle: doc.documentSubtitle ?? doc.issuer ?? 'Filed.',
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
  const busy = doc.status === 'pending' || doc.status === 'processing'
  const unresolved = isUnresolved(doc)
  const { title, subtitle, tone } = resolveCopy(doc)

  // Press-and-hold is the only way into selection mode — the header has no
  // Select button. Pointer events (not touch) so it works with a mouse too.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  // Set when the hold fires, so the click that follows the finger lifting does
  // not ALSO open the document behind the selection UI that just appeared.
  const consumed = useRef(false)

  const cancelPress = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  // A row can unmount mid-hold (the list refetches on a poll), and a timer left
  // running would fire onLongPress for a row that is no longer on screen.
  useEffect(() => cancelPress, [cancelPress])

  const startPress = (e: React.PointerEvent) => {
    if (selectable || !onLongPress) return
    origin.current = { x: e.clientX, y: e.clientY }
    consumed.current = false
    timer.current = setTimeout(() => {
      consumed.current = true
      cancelPress()
      onLongPress()
    }, LONG_PRESS_MS)
  }

  const movePress = (e: React.PointerEvent) => {
    const start = origin.current
    if (!start) return
    if (
      Math.abs(e.clientX - start.x) > LONG_PRESS_SLOP_PX ||
      Math.abs(e.clientY - start.y) > LONG_PRESS_SLOP_PX
    ) {
      cancelPress()
    }
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (consumed.current) {
          consumed.current = false
          return
        }
        if (selectable) onToggleSelect()
        else onOpen()
      }}
      onPointerDown={startPress}
      onPointerMove={movePress}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onPointerLeave={cancelPress}
      // Desktop affordance for the same gesture — a right-click on a list row
      // reaching for "select" should not drop the browser menu on top of it.
      onContextMenu={(e) => {
        if (selectable || !onLongPress) return
        e.preventDefault()
        onLongPress()
      }}
      aria-pressed={selectable ? selected : undefined}
      className={cn(
        'relative flex w-full select-none items-center gap-3.5 rounded-2xl py-3 pr-4 text-left shadow-card transition-colors',
        selectable ? 'pl-3' : 'pl-4',
        selected ? 'bg-accent-soft' : 'bg-surface',
      )}
    >
      {/* The dot is ABSOLUTE, floating in the left margin — it does not get a
          column of its own. A reserved 18px column plus a gap pushed every row
          30px inward to make space for a marker that most rows never show,
          which is a lot of empty gutter to pay for an occasional dot. */}
      {!selectable && unresolved ? (
        <span
          aria-hidden
          className="absolute -left-1 top-1/2 size-2 -translate-y-1/2 rounded-full bg-accent"
        />
      ) : null}

      {/* Selection DOES get a column — the checkbox is the thing being acted
          on, so it earns the space, and the shift only happens on an explicit
          mode change the user just asked for. */}
      {selectable ? (
        <SelectionCheck checked={selected} size={24} />
      ) : null}

      <DocumentTypeIcon type={doc.documentType} size={48} />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-heading-sm', TITLE_TONE[tone])}>
            {title}
          </span>
          <span className="shrink-0 text-caption tabular text-ink-subtle">
            {formatScanTime(doc.createdAt)}
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
