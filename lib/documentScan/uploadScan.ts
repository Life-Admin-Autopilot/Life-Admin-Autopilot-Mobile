// Uploads a captured photo or attached PDF as raw bytes — same mechanism
// /me/voice-notes and /ai/voice/transcribe use, keeping the global JSON body
// limit out of the path. Metadata rides on headers (x-document-scan-*)
// exactly like x-voice-note-* does in lib/ai/transcribe.ts's server sibling.

import { apiBinary, ApiError } from '@/lib/api/client'
import { queryKeys } from '@/queries/keys'
import type { ScannedDocument } from '@/queries/documentScans'
import { useQueryClient } from '@tanstack/react-query'

export type ScanSource = 'camera' | 'pdf' | 'gallery'

export interface UploadScanArgs {
  bytes: ArrayBuffer | Uint8Array
  mimeType: string
  source: ScanSource
  capturedAt?: Date
  signal?: AbortSignal
}

export async function uploadScan(args: UploadScanArgs): Promise<ScannedDocument> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

  const res = await apiBinary<{ scannedDocument: ScannedDocument }>('/me/document-scans', {
    method: 'POST',
    contentType: args.mimeType,
    body: args.bytes instanceof Uint8Array ? args.bytes : new Uint8Array(args.bytes),
    signal: args.signal,
    headers: {
      'x-document-scan-captured-at': (args.capturedAt ?? new Date()).toISOString(),
      'x-document-scan-source': args.source,
      'x-document-scan-timezone': timezone,
    },
  })
  return res.scannedDocument
}

export { ApiError }

// Small hook wrapper so callers get the standard invalidate-on-success
// behavior without duplicating it at each call site (camera + file-input).
export function useUploadScan() {
  const queryClient = useQueryClient()
  return async (args: UploadScanArgs) => {
    const doc = await uploadScan(args)
    void queryClient.invalidateQueries({ queryKey: queryKeys.documentScans })
    return doc
  }
}
