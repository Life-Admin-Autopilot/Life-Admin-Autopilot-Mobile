'use client'

// Camera/attach capture logic for the document flow's 'choose' phase —
// extracted from the old components/scan/CameraCapture.tsx so it can be
// tested independently of JSX/motion. Two capture paths into the same
// upload seam: native (Capacitor iOS/Android) via @capacitor/camera, or web
// (browser dev / no Capacitor build yet) via a hidden <input capture>. A
// separate plain file input covers PDF/gallery attachment on both platforms.
//
// This is the first native Capacitor plugin wired into this project — see
// docs/CAPACITOR.md for the permission-string patch step that must be
// reapplied after every `cap add`/`cap sync` regenerates ios/android.

import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { useUploadScan, ApiError, isRetryableUploadError } from '@/lib/documentScan/uploadScan'
import type { ScanSource, UploadScanArgs } from '@/lib/documentScan/uploadScan'
import {
  ensureCameraAccess,
  isCameraUnavailable,
  isCancellation,
} from '@/lib/documentScan/cameraAccess'
import type { ScannedDocument } from '@/queries/documentScans'

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function fileToBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export interface UseCaptureSourceResult {
  busy: boolean
  error: string | null
  /** A retryable upload failed and its bytes are still held — the caller can
   *  offer "Try again" instead of sending the user back to re-capture. */
  canRetry: boolean
  captureCamera: () => Promise<void>
  captureFile: () => void
  onFileChosen: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  retryUpload: () => Promise<void>
  /** Drop the held payload and clear the error — for "choose a different
   *  document", which must not leave the previous capture retryable. */
  dismissRetry: () => void
}

// The hidden <input type=file> ref is owned by the CALLER, not returned from
// this hook — a custom hook returning a ref bundled into the same plain
// object as other state trips React Compiler's ref-safety analysis (it
// taints every property access on the object as a "ref access during
// render," even for unrelated fields like `error`/`captureFile`).
export function useCaptureSource(
  fileInputRef: React.RefObject<HTMLInputElement | null>,
  onUploaded?: (doc: ScannedDocument) => void,
): UseCaptureSourceResult {
  // A hook, so it translates directly rather than taking a `Translate` argument
  // — lib/i18n/translate.ts is for the pure modules beside it (cameraAccess),
  // not for something already inside the React tree.
  const t = useTranslations('scan')
  const [busy, setBusy] = useState(false)
  // Message and retryability are ONE piece of state, not two. Split, they can
  // contradict each other — "retry available" with no message to explain what
  // went wrong — and every capture entry point would have to remember to reset
  // both. A single nullable object makes the invalid combination unspellable.
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null)
  // The bytes live in a ref, not state: they're megabytes of payload nothing
  // renders, and re-rendering the flow on every capture would be pure cost. The
  // ref is only ever touched inside callbacks, never during render, so it stays
  // clear of the ref-safety analysis noted above.
  const pendingUploadRef = useRef<UploadScanArgs | null>(null)
  const upload = useUploadScan()

  // Every capture entry point starts here: a new capture abandons whatever the
  // last one left behind, so a stale payload can never be resent under a fresh
  // document's error message.
  const beginCapture = () => {
    pendingUploadRef.current = null
    setFailure(null)
  }

  const fail = (err: unknown, retryable: boolean) => {
    const message = err instanceof ApiError ? err.message : t('capture.processFailed')
    logger.warn('captureSource:failed', err)
    setFailure({ message, retryable })
  }

  // Single upload seam for all three entry points (camera, file picker, retry),
  // so the hold-the-payload behavior can't drift between them.
  const runUpload = async (args: UploadScanArgs): Promise<void> => {
    // Stamped once, here, rather than left to uploadScan's `?? new Date()`
    // default. Now that a payload can outlive its first attempt, letting the
    // default fire again would date the document to the RETRY instead of the
    // capture — a scan taken at 11pm and resent after a tunnel at 12:20am would
    // file under the wrong day.
    const stamped: UploadScanArgs = { ...args, capturedAt: args.capturedAt ?? new Date() }
    setBusy(true)
    setFailure(null)
    try {
      const doc = await upload(stamped)
      pendingUploadRef.current = null
      onUploaded?.(doc)
    } catch (err: unknown) {
      const retryable = isRetryableUploadError(err)
      // Held only when a resend could actually work. Dropped otherwise, so the
      // retry button is never offered for bytes the server has already judged.
      pendingUploadRef.current = retryable ? stamped : null
      fail(err, retryable)
    } finally {
      setBusy(false)
    }
  }

  const retryUpload = async (): Promise<void> => {
    const pending = pendingUploadRef.current
    if (!pending || busy) return
    await runUpload(pending)
  }

  const dismissRetry = () => {
    pendingUploadRef.current = null
    setFailure(null)
  }

  const captureCamera = async () => {
    if (busy) return
    beginCapture()
    setBusy(true)
    try {
      // Dynamic import: @capacitor/camera pulls in the native bridge, which
      // has no meaningful browser fallback of its own — Capacitor.isNativePlatform()
      // gates it, but we still avoid loading it unless we're actually native.
      const { Capacitor } = await import('@capacitor/core')
      if (Capacitor.isNativePlatform()) {
        const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera')

        // Resolve access first. getPhoto() prompts on its own the first time,
        // but after a denial it rejects with an opaque error — which is what
        // made a blocked camera surface as "Could not process that scan."
        const access = await ensureCameraAccess(Camera)
        if (access === 'denied') {
          // Not retryable: there are no bytes to resend, and the fix is in
          // Settings, not in tapping again.
          setFailure({
            message: t('capture.cameraDenied', { appName: env.appName }),
            retryable: false,
          })
          setBusy(false)
          return
        }

        let photo
        try {
          photo = await Camera.getPhoto({
            resultType: CameraResultType.Base64,
            source: CameraSource.Camera,
            quality: 80,
          })
        } catch (err) {
          // Backing out of the camera sheet is not an error worth showing.
          if (isCancellation(err)) {
            setBusy(false)
            return
          }
          if (isCameraUnavailable(err)) {
            logger.warn('captureSource:camera-unavailable', err)
            setFailure({ message: t('capture.noCamera'), retryable: false })
            setBusy(false)
            return
          }
          throw err
        }
        if (!photo.base64String) throw new Error('No photo data returned.')
        const bytes = base64ToBytes(photo.base64String)
        const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg'
        // Handles its own busy/failure state — and, crucially, keeps `bytes`
        // alive for a retry. A photo of a physical document is the one payload
        // in this flow the user cannot cheaply reproduce.
        await runUpload({ bytes, mimeType, source: 'camera' })
        return
      }
    } catch (err) {
      // Everything reaching here failed BEFORE any bytes existed (bridge
      // import, permission probe), so there is nothing to resend.
      fail(err, false)
      setBusy(false)
      return
    }
    // Not native (or Capacitor unavailable) — fall back to the browser's
    // native camera capture via a file input, which we trigger below.
    setBusy(false)
    fileInputRef.current?.setAttribute('capture', 'environment')
    fileInputRef.current?.setAttribute('accept', 'image/*')
    fileInputRef.current?.click()
  }

  const captureFile = () => {
    if (busy) return
    beginCapture()
    fileInputRef.current?.removeAttribute('capture')
    fileInputRef.current?.setAttribute('accept', 'application/pdf,image/*')
    fileInputRef.current?.click()
  }

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file next time
    if (!file) return
    // Busy covers the read too — a multi-megabyte PDF takes long enough that
    // leaving the choose buttons live would invite a second pick mid-read.
    setBusy(true)
    let bytes: Uint8Array
    try {
      bytes = await fileToBytes(file)
    } catch (err: unknown) {
      // A file the browser couldn't read has no bytes to resend.
      fail(err, false)
      setBusy(false)
      return
    }
    const source: ScanSource = file.type === 'application/pdf' ? 'pdf' : 'gallery'
    await runUpload({ bytes, mimeType: file.type, source })
  }

  return {
    busy,
    error: failure?.message ?? null,
    canRetry: failure?.retryable ?? false,
    captureCamera,
    captureFile,
    onFileChosen,
    retryUpload,
    dismissRetry,
  }
}
