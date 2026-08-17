'use client'

// Documents — every scan the user has taken, newest first.
//
// One flat, edge-to-edge list. It used to split into "Waiting" and "Filed"
// sections inside bordered cards; the section headers cost a full row each and
// the card borders chopped the list into boxes, so a screen that is fundamentally
// a scan history read like a settings page. Unresolved scans now announce
// themselves with a dot on their own row, which says the same thing without
// cutting the list in two or reordering anything under the user.
//
// The top of the screen is the app's standard chrome (AppHeader) over a sticky
// control row, the same two-part arrangement /matters uses — see
// DocumentsHeader for why the scan action lives in the row rather than the
// header.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { DeleteDocumentsConfirm } from '@/components/scan/DeleteDocumentsConfirm'
import { DocumentCaptureFlow, type DocumentCaptureTrigger } from '@/components/scan/DocumentCaptureFlow'
import { DocumentRow } from '@/components/scan/DocumentRow'
import { DocumentSelectionBar } from '@/components/scan/DocumentSelectionBar'
import { DocumentsHeader } from '@/components/scan/DocumentsHeader'
import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { env } from '@/lib/env'
import { useMorphColors } from '@/lib/motion-colors'
import { useClaimTabBarSlot } from '@/lib/tabBarStore'
import { toast } from '@/lib/toast'
import {
  useDeleteScannedDocuments,
  useScannedDocuments,
  type ScannedDocument,
} from '@/queries/documentScans'

export default function DocumentsPage() {
  const t = useTranslations('scan')
  const router = useRouter()
  // Origin colour for the capture morph, read live off the CTA's own token so
  // the shell reads as that button expanding rather than a new surface popping
  // in. It used to be a hardcoded plum literal left over from a previous
  // theme — the capture flow grew out of a purple rectangle no other pixel on
  // the screen matched.
  const { solid } = useMorphColors()
  const { data, isLoading, isError } = useScannedDocuments()
  const docs = useMemo(() => data?.scannedDocuments ?? [], [data])

  const [trigger, setTrigger] = useState<DocumentCaptureTrigger | null>(null)
  // Every open is its own identity. See the `key` note on the flow below. A ref
  // rather than state: it is never rendered, and bumping it must not schedule a
  // render of its own on top of the one setTrigger already causes.
  const openCount = useRef(0)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmRect, setConfirmRect] = useState<DOMRect | null>(null)

  const deleteDocs = useDeleteScannedDocuments()

  const openCapture = useCallback(
    (rect: DOMRect) => {
      setTrigger({ id: ++openCount.current, rect, mode: 'capture', originColor: solid })
    },
    [solid],
  )

  // ?capture=1 — arriving here already meaning to scan.
  //
  // The Money empty state's "Scan a document" cannot mount the flow itself (it
  // lives in this page's state and morphs out of this page's button), so it
  // deep-links instead and this opens the flow on arrival. The param is stripped
  // with replace() so the back gesture leaves /documents rather than re-opening
  // the scanner, and the ref means the morph still grows out of the real button
  // instead of a made-up rect.
  // Read off `location` rather than useSearchParams(): that hook opts the whole
  // route into client-side rendering unless it sits under its own Suspense
  // boundary, which is a lot of ceremony for one boolean this page only ever
  // reads once, on mount.
  const scanRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('capture') !== '1') return
    const rect = scanRef.current?.getBoundingClientRect()
    if (!rect) return
    openCapture(rect)
    router.replace('/documents')
  }, [openCapture, router])

  const openDocument = useCallback((doc: ScannedDocument, rect: DOMRect) => {
    setTrigger({ id: ++openCount.current, rect, mode: 'open', documentId: doc.id })
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelect = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])

  // Resolved from the live list, not captured at selection time: a background
  // poll can change a document between selecting it and confirming, and the
  // confirm sheet's warnings must describe what is actually about to be
  // deleted. Ids that vanished from the list drop out here on their own.
  const selectedDocs = useMemo(
    () => docs.filter((d) => selected.has(d.id)),
    [docs, selected],
  )
  const allSelected = selected.size > 0 && selected.size === docs.length

  const runDelete = () => {
    const ids = selectedDocs.map((d) => d.id)
    setConfirmOpen(false)
    deleteDocs.mutate(ids, {
      onSuccess: ({ deleted, failed }) => {
        exitSelect()
        // Reported honestly rather than as a flat success — a partial failure
        // that claims "Deleted 5" leaves the user trusting a list that still
        // has two of them in it. Both halves are ONE ICU message with two
        // plurals: Arabic agrees the verb with each count separately, so the
        // sentence cannot be assembled from two independently-translated ones.
        if (failed > 0) {
          toast.error(
            deleted > 0
              ? t('toast.partial', { deleted, failed })
              : t('toast.deleteFailed'),
          )
          return
        }
        toast.info(t('toast.deleted', { count: deleted }))
      },
      onError: () => toast.error(t('toast.deleteFailed')),
    })
  }

  // The action bar lands in the tab bar's exact slot, so the tab bar slides out
  // for the duration. Two bottom-anchored bars stacked on each other is how you
  // get someone tapping Documents when they meant Delete.
  useClaimTabBarSlot(selectMode)

  return (
    <main className="min-h-dvh pb-28">
      <DocumentsHeader
        selectMode={selectMode}
        count={selected.size}
        allSelected={allSelected}
        onCancelSelect={exitSelect}
        onSelectAll={() =>
          setSelected(allSelected ? new Set() : new Set(docs.map((d) => d.id)))
        }
        onScan={openCapture}
        scanRef={scanRef}
      />

      {isLoading ? (
        <ul aria-hidden className="flex flex-col gap-3 px-5 pt-1">
          {[0, 1, 2, 3].map((i) => (
            <li
              key={i}
              className="flex animate-pulse items-center gap-3.5 rounded-2xl bg-surface px-4 py-3 shadow-card"
            >
              <span className="size-12 shrink-0 rounded-tile bg-surface-sunken" />
              <span className="flex min-w-0 flex-1 flex-col gap-2">
                <span className="h-4 w-1/2 rounded-pill bg-surface-sunken" />
                <span className="h-3.5 w-1/3 rounded-pill bg-surface-sunken" />
              </span>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <EmptyState title={t('list.loadFailedTitle')} body={t('list.loadFailedBody')} />
      ) : docs.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-4 px-6 text-center">
          <SketchEmptyTrayGlyph size={104} />
          <div>
            <h2 className="font-display text-heading-serif text-ink">{t('list.emptyTitle')}</h2>
            {/* No CTA of its own — the scan button is already sitting a
                centimetre above this, and two identical buttons that close
                together read as one of them being broken. */}
            <p className="mt-1.5 max-w-[34ch] text-body text-ink-muted">
              {t('list.emptyBody', { appName: env.appName })}
            </p>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3 px-5 pt-1">
          {docs.map((doc) => (
            <RowWithRect
              key={doc.id}
              doc={doc}
              selectable={selectMode}
              selected={selected.has(doc.id)}
              onOpen={openDocument}
              onToggleSelect={() => toggleSelect(doc.id)}
              // Holding a row enters selection with that row already picked —
              // entering an empty selection would make the user hold, then go
              // back and tap the very row they were already touching.
              onLongPress={() => {
                setSelectMode(true)
                setSelected(new Set([doc.id]))
              }}
            />
          ))}
        </ul>
      )}

      <DeleteDocumentsConfirm
        open={confirmOpen}
        docs={selectedDocs}
        trigger={confirmRect}
        pending={deleteDocs.isPending}
        onConfirm={runDelete}
        onClose={() => setConfirmOpen(false)}
      />

      <AnimatePresence>
        {selectMode ? (
          <DocumentSelectionBar
            count={selected.size}
            busy={deleteDocs.isPending}
            onDelete={(rect) => {
              setConfirmRect(rect)
              setConfirmOpen(true)
            }}
          />
        ) : null}
      </AnimatePresence>

      {/* AnimatePresence so the flow gets a real EXIT (collapse + fade back
          into the trigger) instead of being yanked from the DOM the instant
          `trigger` clears — same ownership as VoiceIsland/ChatIsland.

          `key` MUST be per-open, not a constant. A dismissal leaves the child
          mounted for the length of the collapse; a constant key returning
          before that finishes is reconciled as the SAME element, so React
          keeps the instance and its state — the flow re-opened still holding
          the previous `activeDocId` and showed the task you'd just closed.
          A fresh key mounts a fresh flow and lets the outgoing one finish its
          own exit alongside it (sync presence, deliberately not mode="wait" —
          a collapsing surface must never hold up the next one). */}
      <AnimatePresence>
        {trigger ? (
          <DocumentCaptureFlow key={trigger.id} docs={docs} trigger={trigger} onClose={() => setTrigger(null)} />
        ) : null}
      </AnimatePresence>
    </main>
  )
}

// Captures its own row's rect on tap so DocumentCaptureFlow can grow the morph
// shell from wherever this particular row sits in the list, exactly like
// OnboardingIsland captures its island's rect for IslandHandoff.
function RowWithRect({
  doc,
  selectable,
  selected,
  onOpen,
  onToggleSelect,
  onLongPress,
}: {
  doc: ScannedDocument
  selectable: boolean
  selected: boolean
  onOpen: (doc: ScannedDocument, rect: DOMRect) => void
  onToggleSelect: () => void
  onLongPress: () => void
}) {
  const [node, setNode] = useState<HTMLLIElement | null>(null)
  return (
    <li ref={setNode}>
      <DocumentRow
        doc={doc}
        selectable={selectable}
        selected={selected}
        onOpen={() => node && onOpen(doc, node.getBoundingClientRect())}
        onToggleSelect={onToggleSelect}
        onLongPress={onLongPress}
      />
    </li>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <SketchEmptyTrayGlyph />
      <p className="mt-2 font-display text-heading-serif text-ink">{title}</p>
      <p className="max-w-[32ch] text-body text-ink-muted">{body}</p>
    </div>
  )
}
