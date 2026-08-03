'use client'

// The zoomable content for a PDF: every page stacked in one column at unscaled
// size. This element is what the parent transforms, so nothing in here reacts
// to zoom except the rung each page rasterizes at.
//
// Pages are kept live only while they are near the viewport. At fit-to-page a
// short document is entirely on screen and every page is cheap; zoomed in, the
// observer is what stops a long scan from holding forty full-resolution
// canvases at once.

import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { PdfPageCanvas } from '@/components/scan/viewer/PdfPageCanvas'
import type { PdfPageMetrics } from '@/lib/pdf/usePdfDocument'
import type { Size } from '@/lib/viewer/zoomPanMath'

/** Unscaled gap between pages, in content px. */
const PAGE_GAP = 16

/** One viewport of lead-in on each side, so a page is drawn before it is seen. */
const PRERENDER_MARGIN = '100% 0px'

/** Natural size of the whole page column — what fit-to-page is computed against. */
export function pdfContentSize(pages: PdfPageMetrics[]): Size | null {
  if (pages.length === 0) return null
  return {
    width: Math.max(...pages.map((p) => p.width)),
    height: pages.reduce((sum, p) => sum + p.height, 0) + PAGE_GAP * (pages.length - 1),
  }
}

interface PdfStageProps {
  doc: PDFDocumentProxy
  pages: PdfPageMetrics[]
  rasterScale: number
  /** Gesture container, used as the intersection root. */
  root: HTMLElement | null
}

export function PdfStage({ doc, pages, rasterScale, root }: PdfStageProps) {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set([1]))
  const slots = useRef(new Map<number, HTMLElement>())

  useEffect(() => {
    const nodes = [...slots.current.entries()]
    if (nodes.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const page = Number(entry.target.getAttribute('data-page'))
            if (entry.isIntersecting) next.add(page)
            else next.delete(page)
          }
          return next
        })
      },
      { root, rootMargin: PRERENDER_MARGIN },
    )

    for (const [, node] of nodes) observer.observe(node)
    return () => observer.disconnect()
    // `pages` rather than the ref: the slot map is populated during the commit
    // that renders them, so this has to re-run once the nodes actually exist.
  }, [root, pages])

  return (
    <div className="flex flex-col items-center" style={{ gap: PAGE_GAP }}>
      {pages.map((page) => (
        <div
          key={page.pageNumber}
          data-page={page.pageNumber}
          ref={(node) => {
            if (node) slots.current.set(page.pageNumber, node)
            else slots.current.delete(page.pageNumber)
          }}
          // Reserves the page's box whether or not a canvas is mounted in it,
          // so dropping an off-screen canvas cannot collapse the column and
          // move everything the user is looking at.
          style={{ width: page.width, height: page.height }}
          className="shrink-0 bg-white shadow-card"
        >
          {visible.has(page.pageNumber) ? (
            <PdfPageCanvas
              doc={doc}
              pageNumber={page.pageNumber}
              width={page.width}
              height={page.height}
              rasterScale={rasterScale}
              active
            />
          ) : null}
        </div>
      ))}
    </div>
  )
}
