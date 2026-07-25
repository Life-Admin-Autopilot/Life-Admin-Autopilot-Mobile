'use client'

import { useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'

import { AppHeader } from '@/components/layout/AppHeader'
import { Button } from '@/components/ui/button'
import { DocumentCaptureFlow, type DocumentCaptureTrigger } from '@/components/scan/DocumentCaptureFlow'
import { DocumentSections } from '@/components/scan/DocumentSections'
import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { useScannedDocuments, type ScannedDocument } from '@/queries/documentScans'

export default function DocumentsPage() {
  const { data, isLoading } = useScannedDocuments()
  const docs = data?.scannedDocuments ?? []
  const ctaRef = useRef<HTMLButtonElement>(null)
  const [trigger, setTrigger] = useState<DocumentCaptureTrigger | null>(null)
  // Every open is its own identity. See the `key` note on the flow below.
  const openCount = useRef(0)

  const openCapture = () => {
    const rect = ctaRef.current?.getBoundingClientRect()
    if (!rect) return
    // Origin color matches the purple CTA it grows from, so the shell reads
    // as that button expanding rather than a new surface popping in.
    setTrigger({ id: ++openCount.current, rect, mode: 'capture', originColor: 'rgb(142 122 224)' })
  }

  const openDocument = (doc: ScannedDocument, rect: DOMRect) => {
    setTrigger({ id: ++openCount.current, rect, mode: 'open', documentId: doc.id })
  }

  return (
    <main className="min-h-dvh pb-28">
      <AppHeader />

      <div className="mx-auto mt-6 flex max-w-md flex-col gap-4 px-6">
        {isLoading ? (
          <div className="flex flex-col gap-2.5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex animate-pulse flex-col gap-1.5 rounded-lg border border-border bg-surface px-4 py-3.5"
              >
                <div className="h-4 w-1/2 rounded-sm bg-surface-sunken" />
                <div className="h-3 w-1/3 rounded-sm bg-surface-sunken" />
              </div>
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="mt-10 flex flex-col items-center gap-4 text-center">
            <SketchEmptyTrayGlyph size={104} />
            <div>
              <h2 className="font-display text-heading-xl text-ink">Nothing scanned yet</h2>
              <p className="mt-1 text-body-sm text-ink-muted">
                Scan a bill, letter, or form and Mo will pull out anything actionable.
              </p>
            </div>
            <Button ref={ctaRef} className="h-11 w-full max-w-[240px]" onClick={openCapture}>
              Scan a document
            </Button>
          </div>
        ) : (
          <>
            <Button ref={ctaRef} className="h-11 w-full" onClick={openCapture}>
              Scan another document
            </Button>
            <DocumentSections docs={docs} onOpen={openDocument} />
          </>
        )}
      </div>

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
