'use client'

// Opens a PDF Blob and reports every page's intrinsic size, which is what the
// viewer lays out against before a single pixel is rasterized.
//
// Page PROXIES are resolved up front, not lazily per page. Reading a page's
// dict is cheap (it does not touch the content stream) and the alternative is a
// document whose scroll height grows under the user as pages resolve — the
// layout has to be final before the fit-to-page scale can be.

import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { loadPdfjs } from '@/lib/pdf/loadPdfjs'

export interface PdfPageMetrics {
  pageNumber: number
  /** Unscaled CSS px — the page's own size at zoom 1. */
  width: number
  height: number
}

export interface PdfDocumentState {
  doc: PDFDocumentProxy | null
  pages: PdfPageMetrics[]
  loading: boolean
  error: string | null
}

/** Carries the blob its contents describe, so a stale result is recognisable. */
interface Resolved extends PdfDocumentState {
  source: Blob | null
}

const IDLE: PdfDocumentState = { doc: null, pages: [], loading: false, error: null }
const LOADING: PdfDocumentState = { doc: null, pages: [], loading: true, error: null }

export function usePdfDocument(blob: Blob | null): PdfDocumentState {
  const [state, setState] = useState<Resolved>({ ...IDLE, source: null })

  useEffect(() => {
    if (!blob) return

    let cancelled = false
    // Captured rather than read off `state` in cleanup: by teardown the state
    // may already describe a NEWER document, and destroying that one would tear
    // down the viewer the user is currently looking at.
    let opened: PDFDocumentProxy | null = null

    void (async () => {
      try {
        const { loadDocument } = await loadPdfjs()
        const doc = await loadDocument(await blob.arrayBuffer())
        opened = doc

        // A document that arrived after the user moved on is dead weight —
        // release the worker's copy instead of leaking it.
        if (cancelled) return

        const pages: PdfPageMetrics[] = []
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n)
          if (cancelled) return
          const { width, height } = page.getViewport({ scale: 1 })
          pages.push({ pageNumber: n, width, height })
        }

        setState({ source: blob, doc, pages, loading: false, error: null })
      } catch (err: unknown) {
        if (cancelled) return
        setState({
          source: blob,
          doc: null,
          pages: [],
          loading: false,
          // pdf.js messages name internal structures ("XRef", "FormatError").
          // The user gets something true instead.
          error: isPasswordError(err)
            ? 'This PDF is password protected.'
            : 'This PDF could not be opened.',
        })
      }
    })()

    return () => {
      cancelled = true
      // Teardown lives on the loading task, not the document — pdf.js 6 dropped
      // the `PDFDocumentProxy.destroy()` alias. This is what stops the worker
      // and frees its copy of the file.
      void opened?.loadingTask.destroy()
    }
  }, [blob])

  // Derived during render rather than reset from inside the effect: a new blob
  // is loading by definition, and saying so here avoids a render that would
  // otherwise hand the viewer the PREVIOUS document's page list for one frame.
  if (state.source !== blob) return blob ? LOADING : IDLE
  return state
}

function isPasswordError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PasswordException'
}
