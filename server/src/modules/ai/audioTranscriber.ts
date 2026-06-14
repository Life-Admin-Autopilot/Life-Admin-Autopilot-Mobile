// Synchronous audio → text transcription for the chat voice mode.
//
// Unlike voiceNoteTranscriber (which is async + persists a VoiceNote +
// extracts tasks), this is a one-shot transcription: bytes in, text out,
// no DB writes. The chat voice mode uploads recorded audio here, then
// feeds the returned transcript into the normal ask() flow.
//
// Backed by Gemini 2.5 Flash with inline audio data. The model is told to
// transcribe verbatim — no summarization, no task extraction.

import { env } from '../../env'
import { logger } from '../../logger'
import { getGeminiClient } from './provider/geminiClient'

const SYSTEM = [
  'You are a verbatim audio transcriber. Output ONLY the spoken text from the audio.',
  'No preamble, no summary, no quotes around the text, no markdown.',
  "If the audio contains no speech, output exactly: '(no speech detected)'.",
  'Preserve the speaker’s words and punctuation as faithfully as possible.',
].join('\n')

interface TranscribeArgs {
  bytes: Buffer
  mimeType: string
}

const ALLOWED_MIME = new Set([
  'audio/m4a',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/mpeg',
  'audio/webm',
  'audio/ogg',
])

function resolveMime(raw: string): string {
  const trimmed = raw.split(';')[0]?.trim() ?? ''
  // Recorder often labels iOS captures application/octet-stream — fall
  // back to m4a since that's expo-audio's HIGH_QUALITY default on iOS.
  if (!ALLOWED_MIME.has(trimmed)) return 'audio/m4a'
  return trimmed
}

const MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Gemini intermittently returns 503 UNAVAILABLE ("experiencing high demand")
// or 429 under load — both transient. Retry those with a short backoff before
// surfacing the failure to the caller.
function isTransientGeminiError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string }
  if (e?.status === 503 || e?.status === 429 || e?.code === 503 || e?.code === 429) return true
  const msg = typeof e?.message === 'string' ? e.message : ''
  return /unavailable|overloaded|high demand|try again later|rate.?limit/i.test(msg)
}

export async function transcribeAudio({
  bytes,
  mimeType,
}: TranscribeArgs): Promise<string> {
  const client = getGeminiClient()
  const mime = resolveMime(mimeType)

  const request = {
    model: env().GEMINI_STRONG_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: mime,
              data: bytes.toString('base64'),
            },
          },
          { text: 'Transcribe this audio.' },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM,
      // Keep deterministic — we want the literal words, not paraphrasing.
      temperature: 0,
    },
  }

  // Gemini 503/429 under load is transient — retry with a short backoff before
  // letting the failure bubble to the route (which would 500 the client).
  let response: Awaited<ReturnType<typeof client.models.generateContent>> | undefined
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await client.models.generateContent(request)
      break
    } catch (err: unknown) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS && isTransientGeminiError(err)) {
        const delay = 500 * attempt
        logger.warn({ attempt, delay }, 'audioTranscriber:retry-transient')
        await sleep(delay)
        continue
      }
      throw err
    }
  }
  if (!response) throw lastErr

  const text = (response.text ?? '').trim()
  if (!text || text === '(no speech detected)') {
    logger.info({ bytesLen: bytes.length, mime }, 'audioTranscriber:no-speech')
    return ''
  }
  return text
}
