// One-shot audio → text for chat voice mode.
//
// Targets `POST /api/speech/transcribe` — NOT `/ai/voice/transcribe`. The
// latter is part of the Node-parity AI shell, where every IAiProvider
// implementation throws on TranscribeAsync (Langflow's run endpoint is
// text-only), so it answers 503 `ai_not_configured` by design and there is no
// key that turns it on. The real ASR is the MVC controller: nvidia nemotron
// through Hugging Face's router. See the backend's docs/speech-to-text.md.
//
// Two things that endpoint requires and the old raw-bytes route did not:
//
//   1. multipart/form-data with an `audio` file part, not an octet-stream body.
//   2. wav or mp3 — anything else is rejected with ASR_UNSUPPORTED_FORMAT. The
//      recorder already hands us WAV (see useVoiceRecorder.ts), so there is no
//      conversion here.
//
// It also takes a `language`. We send the active app locale, but as a HINT the
// server may fall back on — not as a claim about the audio. The server detects
// first and only pins when detection fails or romanises Arabic. That ordering
// matters because this app is bilingual: the locale describes the interface,
// and a user reading English chrome while dictating Arabic is normal, not an
// edge case. Pinning their Arabic to en-US made the provider return an empty
// transcript, which surfaced as "we could not hear anything" for audio that was
// perfectly audible. The locale is read directly rather than threaded through a
// parameter, since all three call sites would pass the same value.

import { apiForm, ApiError } from '@/lib/api/client'
import { staticMessages } from '@/lib/i18n/staticMessages'
import { currentLocale } from '@/lib/i18n/localeStore'

/** The backend's TranscriptionResponse DTO. A failure is a normal return there, not a throw. */
interface TranscriptionResponse {
  succeeded: boolean
  transcript: string
  detectedLanguage?: string | null
  audioDurationSeconds?: number | null
  latencyMs: number
  errorCode?: string | null
  errorMessage?: string | null
}

export async function transcribeAudio(blob: Blob, signal?: AbortSignal): Promise<string> {
  const cancelled = () =>
    new ApiError('aborted', staticMessages().lib.transcribe.cancelled, 0)

  if (signal?.aborted) throw cancelled()

  const form = new FormData()
  form.append('audio', blob, 'recording.wav')
  // A hint, not a pin — see the note above. 'ar' and 'en' both normalize
  // server-side (LanguageNormalizer): 'ar' → 'ar-AR', since the provider has no
  // ar-EG, and 'en' → 'en-US'.
  form.append('language', currentLocale())

  let res: TranscriptionResponse
  try {
    res = await apiForm<TranscriptionResponse>('/api/speech/transcribe', form, { signal })
  } catch (err) {
    // A non-2xx carries the same DTO in `details`; surface the provider's own
    // safe message (quota exhausted, audio too large) instead of the generic one.
    if (err instanceof ApiError) {
      const body = err.details as TranscriptionResponse | null
      if (body?.errorCode) {
        throw new ApiError(body.errorCode, body.errorMessage ?? err.message, err.status, body)
      }
    }
    throw err
  }

  if (!res.succeeded) {
    throw new ApiError(
      res.errorCode ?? 'unknown_error',
      res.errorMessage ?? staticMessages().errors.generic,
      200,
      res,
    )
  }

  return res.transcript ?? ''
}
