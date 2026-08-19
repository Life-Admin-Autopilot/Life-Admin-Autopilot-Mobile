// Voice notes — the fire-and-forget capture lane.
//
// The user speaks, taps Save, and the island closes. Nothing about the outcome
// is awaited here: this module only hands the bytes to the server and reports
// whether the server took them. Everything after that is the worker's, and the
// client learns the result by polling (queries/voiceNoteFollowUp.ts) or from the
// notification feed.
//
// THE UPLOAD IS NOT A FORM. `POST /me/voice-notes` reads the raw request body as
// the audio and takes its metadata from four `x-voice-note-*` headers — there is
// no multipart part and no field name. Read the .NET endpoint before changing
// any of this: Features/VoiceNotes/VoiceNoteUploadEndpoint.cs (body + content
// type) and Binding/VoiceMetadataBinder.cs (the headers).
//
// The content type is `application/octet-stream`, NOT `audio/wav`. The endpoint
// admits exactly four types — audio/m4a, audio/mp4, audio/aac,
// application/octet-stream — and anything else is rejected as `empty_body`
// BEFORE the size ceiling is even consulted. The recorder produces WAV
// (lib/ai/wavEncoder.ts), which is not on that list, so octet-stream is the one
// honest way to post it. It is also what the note's `mimeType` records.

import { useMutation } from '@tanstack/react-query'

import { api, apiBinary } from '@/lib/api/client'
import { deviceTimeZone } from '@/lib/i18n/dateFormat'

/**
 * The note's lifecycle. `pending → transcribing → extracting` are the worker's;
 * the last three are terminal — nothing more happens unprompted.
 *
 * Mirrors `VoiceNoteVocabulary.Statuses` in the backend
 * (DAL/Features/VoiceNotes/VoiceNoteDocument.cs).
 */
export type VoiceNoteStatus =
  | 'pending'
  | 'transcribing'
  | 'extracting'
  | 'ready'
  | 'needs_review'
  | 'failed'

export const TERMINAL_VOICE_NOTE_STATUSES: readonly VoiceNoteStatus[] = [
  'ready',
  'needs_review',
  'failed',
]

export function isTerminalVoiceNoteStatus(status: string): boolean {
  return (TERMINAL_VOICE_NOTE_STATUSES as readonly string[]).includes(status)
}

/** An item the worker filed as a real matter. `taskId` back-links to the task. */
export interface VoiceExtractedTask {
  key: string
  title: string
  domain: string
  priority: string
  confidence: string
  reviewReason: string
  dueAt?: string
  notes?: string
  taskId?: string
}

/**
 * An item the worker would not file unattended.
 *
 * NOT the same thing as a Clarification. The clarify lane (`clarifyItems`) is
 * stripped by the server's `toJSON` transform and surfaces on
 * `GET /me/clarifications` instead, so a note whose uncertainty became a
 * clarification arrives here with `status: "needs_review"` and an EMPTY
 * `reviewItems`. Any summary built from these counts has to tolerate that.
 */
export interface VoiceReviewItem {
  key: string
  title: string
  domain: string
  priority: string
  confidence: string
  reviewReason: string
  reasons: string[]
  dueRaw?: string
  dueAt?: string
  notes?: string
}

/** `VoiceNoteDto` on the wire. Eight document fields never reach a client. */
export interface VoiceNote {
  id: string
  userId: string
  durationMs: number
  byteSize: number
  source: string
  status: VoiceNoteStatus
  clientCapturedAt: string
  timezone?: string
  mimeType?: string
  extractedTasks: VoiceExtractedTask[]
  reviewItems: VoiceReviewItem[]
  createdAt: string
  updatedAt: string
  transcript?: string
  /** Plain-language failure text, safe to show. Distinct from the internal `lastError`. */
  failureReason?: string
  reviewedAt?: string
}

export interface VoiceNoteResponse {
  voiceNote: VoiceNote
}

/** `x-voice-note-duration-ms` is `.int().min(0).max(600000)`. */
const MAX_DURATION_MS = 10 * 60 * 1000

const UPLOAD_CONTENT_TYPE = 'application/octet-stream'

export interface UploadVoiceNoteInput {
  blob: Blob
  /** Wall-clock length of the capture. Clamped to the schema's 0..600000. */
  durationMs: number
  signal?: AbortSignal
}

function metadataHeaders(durationMs: number): Record<string, string> {
  const bounded = Math.min(Math.max(Math.round(durationMs), 0), MAX_DURATION_MS)
  // The moment the user started speaking, not the moment the upload left. The
  // worker resolves "tomorrow" against this instant in the zone below, and the
  // two can straddle midnight on a long note.
  const capturedAt = new Date(Date.now() - bounded).toISOString()
  const timezone = deviceTimeZone()

  return {
    'x-voice-note-duration-ms': String(bounded),
    // zod's `.datetime()` here is stricter than it looks: RFC 3339 with a
    // literal Z and no offset form. `toISOString()` is exactly that.
    'x-voice-note-captured-at': capturedAt,
    'x-voice-note-source': 'app',
    // The server stores this verbatim (no IANA check on THIS route) and the
    // worker resolves local times against it. An absent header is allowed;
    // a present-but-empty one fails `.min(1)`, so omit rather than send blank.
    ...(timezone ? { 'x-voice-note-timezone': timezone } : {}),
  }
}

/**
 * Hand the recording to the server. Resolves with the accepted note (202).
 *
 * Deliberately has no `onSuccess` cache work: nothing the user can see has
 * changed yet — the note is `pending` and no matter exists. Invalidation belongs
 * to the follow-up, which knows what the worker actually did.
 */
export function useUploadVoiceNote() {
  return useMutation({
    mutationFn: async ({ blob, durationMs, signal }: UploadVoiceNoteInput): Promise<VoiceNote> => {
      const res = await apiBinary<VoiceNoteResponse>('/me/voice-notes', {
        contentType: UPLOAD_CONTENT_TYPE,
        body: blob,
        headers: metadataHeaders(durationMs),
        signal,
      })
      return res.voiceNote
    },
  })
}

/** One note, by id. Used by the follow-up poll; 404s as `voice_note_not_found`. */
export function voiceNotePath(noteId: string): string {
  return `/me/voice-notes/${encodeURIComponent(noteId)}`
}

/**
 * Put a failed note back in the queue.
 *
 * The failure toast has said "It is kept — retry from Notifications" since voice
 * shipped, and nothing anywhere could retry one: there is no notifications route,
 * the bell has no voice handling, and the only voice write endpoints re-ran
 * EXTRACTION over a stored transcript — useless to a note that died before it had
 * one. The audio really was kept; the promise was simply unkeepable.
 *
 * Not a `useMutation`: the caller is the background follow-up poll, which lives
 * outside React's render tree by design (see voiceNoteFollowUp.ts) and fires this
 * from a toast action. Resolves to the note's new state.
 *
 * The server refuses with 503 `transcription_unavailable` while the provider is
 * known to be down, rather than re-queueing a note to fail the same way seconds
 * later — so a rejection here is information, not an error to swallow.
 */
export function retryVoiceNote(noteId: string): Promise<VoiceNote> {
  return api<VoiceNoteResponse>(`${voiceNotePath(noteId)}/retry`, { method: 'POST' }).then(
    (res) => res.voiceNote,
  )
}
