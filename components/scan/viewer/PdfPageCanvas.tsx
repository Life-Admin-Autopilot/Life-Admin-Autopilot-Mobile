'use client'

// One PDF page, rasterized to one canvas.
//
// The canvas is always laid out at the page's UNSCALED size — zoom is the
// parent's transform, never this element's box. The backing store is what grows
// with zoom, so text re-sharpens on each rung of the raster ladder while the
// layout the fit-scale was computed from stays fixed.
//
// An inactive page drops its canvas entirely rather than hiding it. A 40-page
// scan held at 4x would be several hundred megabytes of backing store, and iOS
// answers that by evicting canvases and painting them white.

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'

import { budgetedRasterScale } from '@/lib/viewer/rasterLadder'

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy
  pageNumber: number
  /** The page's own size at zoom 1, in CSS px. */
  width: number
  height: number
  /** Content-px per CSS-px to rasterize at — a rung, not the live zoom. */
  rasterScale: number
  active: boolean
}

export function PdfPageCanvas({ doc, pageNumber, width, height, rasterScale, active }: PdfPageCanvasProps) {
  const t = useTranslations('scan')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return

    let task: RenderTask | null = null
    let cancelled = false

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return

        const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
        const scale = budgetedRasterScale(rasterScale, dpr, { width, height })
        const viewport = page.getViewport({ scale })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        task = page.render({ canvas, viewport })
        await task.promise
      } catch {
        // cancel() rejects by design, and a page that fails to draw leaves the
        // previous bitmap on screen rather than a hole. Nothing to report: the
        // document-level failure path already covers an unreadable file.
      }
    })()

    return () => {
      cancelled = true
      // Must happen before the next render starts — pdf.js refuses to draw two
      // operations onto one canvas and throws instead.
      task?.cancel()
    }
  }, [doc, pageNumber, width, height, rasterScale, active])

  return (
    <canvas
      ref={canvasRef}
      // Layout size is fixed to the page; only the backing store scales.
      style={{ width, height }}
      className="block"
      aria-label={t('viewer.page', { number: pageNumber })}
      role="img"
    />
  )
}
