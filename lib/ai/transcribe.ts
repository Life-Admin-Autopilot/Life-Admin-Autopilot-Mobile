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

export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  const buffer = await blob.arrayBuffer()
  if (signal?.aborted) throw new ApiError('aborted', 'Cancelled.', 0)

  const res = await apiBinary<{ text: string }>('/ai/voice/transcribe', {
    method: 'POST',
    contentType: 'application/octet-stream',
    body: new Uint8Array(buffer),
    signal,
  })
  return res.text ?? ''
}
