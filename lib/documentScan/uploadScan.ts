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

// Whether resending the SAME bytes could plausibly succeed. This is what
// decides between offering a retry button and sending the user back to capture,
// so it has to be conservative in one specific direction: a retry that always
// fails is worse than no retry at all, because it reads as the app being broken
// rather than the document being wrong.
//
// A 4xx is a verdict on the document — wrong file type, too many pages, over
// the monthly cap (402) — and will land identically every time. A non-ApiError
// is the fetch itself failing (offline, DNS, connection reset), which is the
// single most common reason an upload dies on a phone and the case this whole
// path exists for. 401 is excluded because apiBinary already did its one-shot
// refresh-and-retry before throwing: a 401 that survives that is a dead session,
// not a blip.
export function isRetryableUploadError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true
  if (err.status >= 500) return true
  return err.status === 408 || err.status === 429
}

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
