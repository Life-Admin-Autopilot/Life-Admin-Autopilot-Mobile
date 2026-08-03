'use client'

// Lazy, memoised entry point to pdf.js.
//
// The library is ~500KB before the worker, and most sessions never open a PDF —
// so it is behind a dynamic import() and lands in its own chunk, fetched the
// first time someone actually taps a scan. Nothing here runs at module scope.
//
// The `legacy` build is the deliberate choice: a Capacitor WebView's engine
// version is the OS's, not the app's, so the browser baseline is whatever
// release the user is on rather than something the build can assume.
//
// Every URL below points at public/pdfjs/, vendored by
// scripts/copy-pdfjs-assets.mjs. They are read by the WORKER thread, not the
// bundler, which is why they are strings and not imports.

import type { PDFDocumentProxy } from 'pdfjs-dist'

// Root-absolute so it resolves the same under `next dev`, the static export,
// and `capacitor://localhost` — where the export is the document root.
// Trailing slashes are required: pdf.js concatenates filenames straight on.
const ASSETS = '/pdfjs/'

export interface PdfjsRuntime {
  loadDocument: (data: ArrayBuffer) => Promise<PDFDocumentProxy>
}

let runtime: Promise<PdfjsRuntime> | null = null

export function loadPdfjs(): Promise<PdfjsRuntime> {
  // Memoised on the PROMISE, not the resolved value, so two scans opened in
  // quick succession share one download and one worker rather than racing.
  runtime ??= import('pdfjs-dist/legacy/build/pdf.min.mjs').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`

    return {
      loadDocument: (data: ArrayBuffer) =>
        pdfjs.getDocument({
          // NOTE: pdf.js transfers this buffer to the worker and detaches it
          // here. Callers must hand over a buffer they will not read again.
          data,
          // Without these a PDF that references Helvetica without embedding it
          // renders blank, and CID-keyed text (Arabic, CJK) renders as tofu.
          cMapUrl: `${ASSETS}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${ASSETS}standard_fonts/`,
          // JBIG2 / JPEG 2000 decoders. Scanners and fax-to-PDF pipelines emit
          // both, which is precisely what this app is pointed at.
          wasmUrl: `${ASSETS}wasm/`,
          iccUrl: `${ASSETS}iccs/`,
        }).promise,
    }
  })

  return runtime
}
