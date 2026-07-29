'use client'

// A plain attachment row for the original scanned file — real image
// thumbnail when the scan is a photo, a file icon for PDFs (matching how
// e.g. Mercury/GoPay's own attachment rows work — nobody renders a live PDF
// page thumbnail for this). Fetches once and reuses the same object URL
// everywhere it's needed — no second network round trip.
//
// Images open in an in-app popup (DocumentViewer-style <img>, looks like
// part of the app). PDFs open in a new browser tab instead of an embedded
// <embed>/<iframe> viewer — the browser's own PDF UI (toolbar, dark canvas)
// doesn't fit inside a small in-app modal and reads as broken there; a full
// tab is PDFs' normal, expected home.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowUpRight, Eye, FileText, X } from 'lucide-react'

import { apiBlob, ApiError } from '@/lib/api/client'
import { MORPH_BACKDROP_FADE } from '@/lib/motion'
import type { ScannedDocument } from '@/queries/documentScans'

interface LoadState {
  docId: string
  url: string | null
  error: string | null
}

function fileLabel(doc: ScannedDocument): string {
  if (doc.mimeType === 'application/pdf') {
    return doc.pageCount === 1 ? 'PDF · 1 page' : `PDF · ${doc.pageCount} pages`
  }
  return 'Photo'
}

export function OriginalDocumentPeek({ doc }: { doc: ScannedDocument }) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const [state, setState] = useState<LoadState | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    apiBlob(`/me/document-scans/${doc.id}/file`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ docId: doc.id, url: objectUrl, error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          docId: doc.id,
          url: null,
          error: err instanceof ApiError ? err.message : 'Could not load the original scan.',
        })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.id])

  const current = state?.docId === doc.id ? state : null
  const url = current?.url ?? null
  const isImage = doc.mimeType !== 'application/pdf'

  const handleTap = () => {
    if (!url) return
    if (isImage) {
      setOpen(true)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleTap}
        disabled={!url}
        className="flex w-full items-center gap-3 rounded-xl bg-surface-field px-3.5 py-3 text-start transition-colors hover:brightness-[0.97] disabled:opacity-60"
      >
        {isImage && url ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob object URL thumbnail, not an optimizable asset
          <img src={url} alt="" className="size-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-sunken">
            <FileText size={18} className="text-ink-subtle" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-medium text-ink">Original document</span>
          <span className="truncate text-caption text-ink-subtle">{current?.error ?? fileLabel(doc)}</span>
        </div>
        {isImage ? (
          <Eye size={16} className="shrink-0 text-ink-subtle" />
        ) : (
          <ArrowUpRight size={16} className="shrink-0 text-ink-subtle" />
        )}
      </button>

      {isImage ? (
        <>
          <AnimatePresence>
            {open ? (
              <motion.div
                key="doc-peek-backdrop"
                variants={MORPH_BACKDROP_FADE}
                initial="initial"
                animate="animate"
                exit="exit"
                onClick={() => setOpen(false)}
                aria-hidden
                className="fixed inset-0 z-[60] bg-ink/50 backdrop-blur-md"
              />
            ) : null}
          </AnimatePresence>

          <AnimatePresence>
            {open ? (
              <motion.div
                key="doc-peek-panel"
                role="dialog"
                aria-label="Original document"
                initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
                transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="inset-safe fixed z-[61] flex flex-col overflow-hidden rounded-xl bg-surface shadow-elevated"
              >
                <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-body-sm font-medium text-ink">Original document</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="rounded-full p-1 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div className="flex flex-1 items-center justify-center overflow-hidden bg-surface-sunken p-3">
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- blob object URL, not an optimizable asset
                    <img src={url} alt="Scanned document" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <p className="text-body-sm text-ink-subtle">{current?.error ?? 'Loading…'}</p>
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </>
      ) : null}
    </>
  )
}
