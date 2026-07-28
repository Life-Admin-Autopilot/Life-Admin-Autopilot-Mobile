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

import { useState } from 'react'

import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { useUploadScan, ApiError } from '@/lib/documentScan/uploadScan'
import type { ScanSource } from '@/lib/documentScan/uploadScan'
import {
  cameraDeniedMessage,
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
  captureCamera: () => Promise<void>
  captureFile: () => void
  onFileChosen: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const upload = useUploadScan()

  const handleError = (err: unknown) => {
    const message = err instanceof ApiError ? err.message : 'Could not process that scan.'
    logger.warn('captureSource:failed', err)
    setError(message)
  }

  const captureCamera = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
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
          setError(cameraDeniedMessage(env.appName))
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
            setError('No camera available on this device. Choose a file instead.')
            setBusy(false)
            return
          }
          throw err
        }
        if (!photo.base64String) throw new Error('No photo data returned.')
        const bytes = base64ToBytes(photo.base64String)
        const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg'
        const doc = await upload({ bytes, mimeType, source: 'camera' })
        onUploaded?.(doc)
        setBusy(false)
        return
      }
    } catch (err) {
      handleError(err)
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
    fileInputRef.current?.removeAttribute('capture')
    fileInputRef.current?.setAttribute('accept', 'application/pdf,image/*')
    fileInputRef.current?.click()
  }

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file next time
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const bytes = await fileToBytes(file)
      const source: ScanSource = file.type === 'application/pdf' ? 'pdf' : 'gallery'
      const doc = await upload({ bytes, mimeType: file.type, source })
      onUploaded?.(doc)
    } catch (err) {
      handleError(err)
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, captureCamera, captureFile, onFileChosen }
}
