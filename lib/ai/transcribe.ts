// One-shot audio → text for chat voice mode. POSTs the recording's raw bytes
// with an audio content-type — the same mechanism /me/voice-notes uses. Raw
// bytes (not base64-in-JSON) keep the global JSON body limit out of the path.
// Counts toward the daily message quota. The AbortSignal cancels an in-flight
// upload ("Discard").
//
// Browser MediaRecorder produces a Blob whose MIME varies by engine
// (audio/webm;codecs=opus on Chrome, audio/mp4 on Safari). The server route
// whitelists audio/m4a | audio/mp4 | audio/aac | application/octet-stream, so we
// send application/octet-stream — the transcriber forwards the bytes to Gemini,
// which sniffs the container itself.

import { apiBinary, ApiError } from '@/lib/api/client'
import { staticMessages } from '@/lib/i18n/staticMessages'

export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  const buffer = await blob.arrayBuffer()
  // Catalogue read rather than a translator argument: this is one plain
  // sentence on a cancellation path, and threading `t` for it would put an i18n
  // parameter on transcribeAudio for all three of its call sites. Lookup only,
  // no ICU — the constraint lib/i18n/staticMessages.ts sets.
  if (signal?.aborted) throw new ApiError('aborted', staticMessages().lib.transcribe.cancelled, 0)

  const res = await apiBinary<{ text: string }>('/ai/voice/transcribe', {
    method: 'POST',
    contentType: 'application/octet-stream',
    body: new Uint8Array(buffer),
    signal,
  })
  return res.text ?? ''
}
