'use client'

// The attachment row for a scan's original file — a real image thumbnail for a
// photo, a file icon for a PDF, matching how any bank or invoicing app renders
// an attachment. Nobody draws a live PDF page thumbnail for this.
//
// Tapping opens DocumentViewer, on every platform and for both file types.
// There is no longer a web/native seam here: the app renders documents itself
// (pdf.js + lib/viewer) rather than delegating to the host, so there is nothing
// left for a new browser tab or a WKWebView <iframe> to do better.
//
// The bytes are fetched ONCE, on mount, and the same Blob backs the thumbnail,
// the viewer and pdf.js — no second round trip when the row is tapped.

import { useCallback, useEffect, useState } from 'react'
import { Eye, FileText, RotateCw } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { DocumentViewer } from '@/components/scan/viewer/DocumentViewer'
import { apiBlob, ApiError } from '@/lib/api/client'
import type { ScannedDocument } from '@/queries/documentScans'

interface LoadState {
  blob: Blob | null
  url: string | null
  /**
   * The backend's own words when it gave any, otherwise null — the generic
   * line is resolved at RENDER time, not stored here, so the fetch effect
   * never has to depend on the translator and re-download the file every time
   * the language changes.
   */
  error: string | null
  failed: boolean
  loading: boolean
}

/** Tags a result with the fetch it came from, so a stale one is recognisable. */
interface Resolved extends LoadState {
  key: string
}

const LOADING: LoadState = { blob: null, url: null, error: null, failed: false, loading: true }

export function OriginalDocumentPeek({ doc }: { doc: ScannedDocument }) {
  const t = useTranslations('scan')
  const [open, setOpen] = useState(false)
  // Bumped to re-run the fetch after a failure. A dead row with an error on it
  // and no way to try again is the worst of both.
  const [attempt, setAttempt] = useState(0)
  const [resolved, setResolved] = useState<Resolved>({ ...LOADING, key: '' })

  const key = `${doc.id}:${attempt}`

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    apiBlob(`/me/document-scans/${doc.id}/file`)
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setResolved({ key, blob, url: objectUrl, error: null, failed: false, loading: false })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResolved({
          key,
          blob: null,
          url: null,
          error: err instanceof ApiError ? err.message : null,
          failed: true,
          loading: false,
        })
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc.id, key])

  // Derived rather than reset inside the effect: a fetch that has not reported
  // back yet IS loading, and re-deriving here keeps the row from showing the
  // previous document's thumbnail for a frame after a retry.
  const state: LoadState = resolved.key === key ? resolved : LOADING

  const isPdf = doc.mimeType === 'application/pdf'
  const failed = state.failed
  const detail = failed
    ? (state.error ?? t('peek.loadFailed'))
    : state.loading
      ? t('peek.loading')
      : isPdf
        ? t('peek.pdfPages', { count: doc.pageCount })
        : t('peek.photo')

  const handleTap = useCallback(() => {
    if (failed) {
      setAttempt((n) => n + 1)
      return
    }
    // Deliberately NOT gated on the bytes having landed. The viewer opens
    // immediately and shows its own progress; a row that silently ignores taps
    // while a slow file downloads is indistinguishable from a broken one.
    setOpen(true)
  }, [failed])

  return (
    <>
      <button
        type="button"
        onClick={handleTap}
        className="flex w-full items-center gap-3 rounded-xl bg-surface-field px-3.5 py-3 text-start transition-colors hover:brightness-[0.97]"
      >
        {!isPdf && state.url ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob object URL thumbnail, not an optimizable asset
          <img src={state.url} alt="" className="size-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-sunken">
            <FileText size={18} className="text-ink-subtle" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-sm font-medium text-ink">{t('peek.title')}</span>
          <span className="truncate text-caption text-ink-subtle">{detail}</span>
        </div>
        {failed ? (
          <RotateCw size={16} className="shrink-0 text-ink-subtle" />
        ) : (
          <Eye size={16} className="shrink-0 text-ink-subtle" />
        )}
      </button>

      <DocumentViewer
        open={open}
        onClose={() => setOpen(false)}
        blob={state.blob}
        url={state.url}
        isPdf={isPdf}
      />
    </>
  )
}
