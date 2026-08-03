'use client'

// Throwaway preview route — DocumentViewer against real scan bytes, without a
// login or a capture flow. Delete when done.

import { useEffect, useState } from 'react'

import { DocumentViewer } from '@/components/scan/viewer/DocumentViewer'

export default function PreviewViewerPage() {
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [isPdf, setIsPdf] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void fetch(isPdf ? '/zz-test.pdf' : '/zz-test.jpg')
      .then((r) => r.blob())
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(b)
        setBlob(b)
        setUrl(objectUrl)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [isPdf])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setIsPdf(true)
            setBlob(null)
            setUrl(null)
          }}
          className="rounded-lg bg-surface px-4 py-2 text-body-sm shadow-card"
        >
          PDF
        </button>
        <button
          type="button"
          onClick={() => {
            setIsPdf(false)
            setBlob(null)
            setUrl(null)
          }}
          className="rounded-lg bg-surface px-4 py-2 text-body-sm shadow-card"
        >
          Photo
        </button>
      </div>
      <button
        type="button"
        id="zz-open"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-accent px-4 py-2 text-body-sm text-white shadow-card"
      >
        Open viewer ({isPdf ? 'pdf' : 'photo'}, {blob ? 'loaded' : 'loading'})
      </button>
      <DocumentViewer open={open} onClose={() => setOpen(false)} blob={blob} url={url} isPdf={isPdf} />
    </main>
  )
}
