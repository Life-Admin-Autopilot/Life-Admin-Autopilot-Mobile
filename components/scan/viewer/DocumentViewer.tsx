'use client'

// The full-panel viewer for an original scan.
//
// One surface for every platform and both file types. The old split — an
// in-app <img> for photos, a new browser tab for PDFs on web, an <iframe> for
// PDFs on native — is gone: WKWebView's built-in PDF viewer renders a page at
// its intrinsic size inside whatever box it is given and does not forward pinch
// to a nested frame, so a bill opened already cropped with no way to zoom out.
// Owning the rasterization is the only way to own fit-to-page and zoom, so
// pdf.js draws the pages and lib/viewer drives the gestures.
//
// pdf.js is dynamically imported (see lib/pdf/loadPdfjs.ts), so a session that
// never opens a PDF never pays for it.

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Maximize2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { PdfStage, pdfContentSize } from '@/components/scan/viewer/PdfStage'
import { ZoomPanSurface } from '@/components/scan/viewer/ZoomPanSurface'
import { usePdfDocument } from '@/lib/pdf/usePdfDocument'
import { MORPH_BACKDROP_FADE } from '@/lib/motion'
import { rasterStepFor } from '@/lib/viewer/rasterLadder'
import { useZoomPan } from '@/lib/viewer/useZoomPan'
import type { Size } from '@/lib/viewer/zoomPanMath'

interface DocumentViewerProps {
  open: boolean
  onClose: () => void
  /** The original bytes. Null while they are still being fetched. */
  blob: Blob | null
  /** Object URL for the same bytes — used for the image path. */
  url: string | null
  isPdf: boolean
}

export function DocumentViewer({ open, onClose, blob, url, isPdf }: DocumentViewerProps) {
  const reduced = useReducedMotion()
  const t = useTranslations('scan')

  return (
    <>
      <AnimatePresence>
        {open ? (
          <motion.div
            key="doc-viewer-backdrop"
            variants={MORPH_BACKDROP_FADE}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={onClose}
            aria-hidden
            className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-md"
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            key="doc-viewer-panel"
            role="dialog"
            aria-modal
            aria-label={t('peek.title')}
            initial={reduced ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.16 } }}
            transition={reduced ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="inset-safe fixed z-[61] flex flex-col overflow-hidden rounded-xl bg-surface shadow-elevated"
          >
            {/* Remounted per open so a new document never inherits the last
                one's zoom, and so pdf.js releases the worker on close. */}
            <ViewerBody blob={blob} url={url} isPdf={isPdf} onClose={onClose} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

function ViewerBody({
  blob,
  url,
  isPdf,
  onClose,
}: {
  blob: Blob | null
  url: string | null
  isPdf: boolean
  onClose: () => void
}) {
  const reduced = useReducedMotion()
  const t = useTranslations('scan')
  const tCommon = useTranslations('common')
  const pdf = usePdfDocument(isPdf ? blob : null)
  const [imageSize, setImageSize] = useState<Size | null>(null)

  const content = isPdf ? pdfContentSize(pdf.pages) : imageSize
  const { containerRef, contentRef, settledScale, fitScale, isZoomed, resetToFit } = useZoomPan({
    content,
    reducedMotion: Boolean(reduced),
  })

  // The gesture container doubles as the intersection root for page culling,
  // so PdfStage needs the element itself, not just the ref callback.
  const [root, setRoot] = useState<HTMLDivElement | null>(null)

  // MUST be memoised. An inline ref callback is a new function every render, so
  // React detaches and reattaches it on every commit — and both of these set
  // state, which would render again, forever.
  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef(node)
      setRoot(node)
    },
    [containerRef],
  )

  const rasterScale = rasterStepFor(settledScale, fitScale)
  const status = isPdf
    ? pdf.error ?? (pdf.doc ? null : t('viewer.opening'))
    : // An image is only ready once it has decoded — `url` alone still leaves a
      // frame with nothing laid out, because fit is computed from natural size.
      url && imageSize
      ? null
      : t('viewer.opening')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="truncate text-body-sm font-medium text-ink">{t('peek.title')}</span>
        <div className="flex shrink-0 items-center gap-1">
          {/* Only offered once there is something to get back FROM. A control
              that is always visible but inert most of the time reads as broken. */}
          {isZoomed ? (
            <button
              type="button"
              onClick={resetToFit}
              aria-label={t('viewer.fitToScreen')}
              className="rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Maximize2 size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label={tCommon('close')}
            className="rounded-full p-1 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 bg-surface-sunken">
        <ZoomPanSurface
          containerRef={attachContainer}
          contentRef={contentRef}
          content={content}
          className="absolute inset-0"
        >
          {isPdf ? (
            pdf.doc ? (
              <PdfStage doc={pdf.doc} pages={pdf.pages} rasterScale={rasterScale} root={root} />
            ) : null
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob object URL, not an optimizable asset
            <img
              src={url}
              alt={t('viewer.imageAlt')}
              // Laid out at natural size; the surface's transform is the only
              // thing that scales it, exactly as with a PDF page.
              style={imageSize ? { width: imageSize.width, height: imageSize.height } : undefined}
              onLoad={(e) =>
                setImageSize({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
              draggable={false}
              className="block max-w-none select-none bg-white shadow-card"
            />
          ) : null}
        </ZoomPanSurface>

        {status ? (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-body-sm text-ink-subtle">
            {status}
          </p>
        ) : null}
      </div>
    </>
  )
}
