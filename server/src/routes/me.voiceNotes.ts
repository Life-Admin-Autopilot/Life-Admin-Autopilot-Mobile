import { Router, raw } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { buildStorageKey, getVoiceNoteStorage } from '../lib/voiceNoteStorage'
import {
  draftToClarifyItem,
  enqueueTranscription,
  persistClarifications,
} from '../lib/voiceNoteTranscriber'
import { requireAuth } from '../middleware/auth'
import { aiVoiceLimiter } from '../middleware/rateLimit'
import {
  VOICE_NOTE_SOURCES,
  VoiceNote,
  type ExtractedTask,
  type ReviewItem,
} from '../models/VoiceNote'
import { DOMAINS } from '../models/User'
import { TASK_PRIORITIES } from '../models/Task'
import { env } from '../env'
import { extractItems } from '../modules/ai/voiceCore/extract'
import { gateAndKey } from '../modules/ai/voiceCore/gate'
import { persistTasksFromItems } from '../modules/ai/voiceCore/persist'
import type { ExtractedItem } from '../modules/ai/voiceCore/contract'

export const meVoiceNotesRouter = Router()

const domainEnum = z.enum([...DOMAINS] as [string, ...string[]])
const priorityEnum = z.enum([...TASK_PRIORITIES] as [string, ...string[]])

// A bad timezone string used to crash extraction with a RangeError deep in
// Intl.DateTimeFormat (→ 500). Validate it as a real IANA zone at the request
// boundary and reject with a friendly 400 instead. `Intl.supportedValuesOf`
// isn't on every runtime, so probe by constructing a formatter (the same call
// the extractor makes) and catching the RangeError.
function isValidIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const ExtractBodySchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidIanaTimeZone, { message: 'must be a valid IANA timezone' })
    .optional(),
})

const maxBytes = () => env().VOICE_NOTE_MAX_BYTES
const maxMb = () => Math.round(maxBytes() / (1024 * 1024))

// Header-based metadata keeps the request a single raw audio body —
// avoids dragging multer into the stack for one binary field.
const HeadersSchema = z.object({
  durationMs: z.coerce.number().int().min(0).max(10 * 60 * 1000),
  capturedAt: z
    .string()
    .datetime()
    .transform((v) => new Date(v)),
  source: z.enum(VOICE_NOTE_SOURCES).default('app'),
  timezone: z.string().min(1).max(64).optional(),
})

meVoiceNotesRouter.post(
  '/me/voice-notes',
  requireAuth,
  // Per-user upload rate limit (audio is heavy + each note triggers a
  // transcription + extraction round). After auth so it keys on the user id.
  aiVoiceLimiter,
  // raw() ceiling sits above the friendly limit so the explicit check below
  // returns a friendly 400 (not body-parser's terse 413) for normal oversize.
  raw({
    type: ['audio/m4a', 'audio/mp4', 'audio/aac', 'application/octet-stream'],
    limit: maxBytes() * 2,
  }),
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const bytes = req.body as Buffer | undefined
    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw BadRequest('empty_body', 'No audio payload received.')
    }
    if (bytes.length > maxBytes()) {
      throw BadRequest('payload_too_large', `Voice note exceeds ${maxMb()}MB.`)
    }

    const meta = HeadersSchema.safeParse({
      durationMs: req.header('x-voice-note-duration-ms'),
      capturedAt: req.header('x-voice-note-captured-at'),
      source: req.header('x-voice-note-source'),
      timezone: req.header('x-voice-note-timezone'),
    })
    if (!meta.success) {
      throw BadRequest('invalid_metadata', 'Missing or invalid x-voice-note-* headers.', meta.error.flatten())
    }

    // Generate the id up-front so the storage key can be computed before the
    // first save — the schema marks `storageKey` required.
    const id = new Types.ObjectId()
    const key = buildStorageKey(auth.sub, id.toHexString())
    await getVoiceNoteStorage().put(key, bytes)

    const contentType = (req.header('content-type') ?? '').split(';')[0]?.trim()

    const note = await VoiceNote.create({
      _id: id,
      userId: auth.sub,
      storageKey: key,
      durationMs: meta.data.durationMs,
      byteSize: bytes.length,
      source: meta.data.source,
      status: 'pending',
      clientCapturedAt: meta.data.capturedAt,
      timezone: meta.data.timezone,
      mimeType: contentType || undefined,
    })

    enqueueTranscription(note.id)

    res.status(202).json({ voiceNote: note.toJSON() })
  }),
)

meVoiceNotesRouter.get(
  '/me/voice-notes',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const notes = await VoiceNote.find({ userId: auth.sub }).sort({ createdAt: -1 }).limit(50)
    res.status(200).json({
      voiceNotes: notes.map((n) => n.toJSON()),
    })
  }),
)

meVoiceNotesRouter.get(
  '/me/voice-notes/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const note = await VoiceNote.findOne({ _id: req.params.id, userId: auth.sub })
    if (!note) throw NotFound('voice_note_not_found', 'Voice note no longer exists.')
    res.status(200).json({ voiceNote: note.toJSON() })
  }),
)

// Manual / fallback re-extraction. The worker already extracts automatically;
// this re-runs extraction on the stored transcript. Idempotent — the keyed
// upsert means a second call never double-creates tasks.
meVoiceNotesRouter.post(
  '/me/voice-notes/:id/extract-tasks',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    // Validate the body BEFORE touching the note so a malformed timezone
    // returns a 400 invalid_body instead of crashing the extractor with a
    // RangeError (→ 500) deep inside Intl.DateTimeFormat.
    const parsedBody = ExtractBodySchema.safeParse(req.body ?? {})
    if (!parsedBody.success) {
      throw BadRequest('invalid_body', 'Invalid extract payload.', parsedBody.error.flatten())
    }

    const note = await VoiceNote.findOne({ _id: req.params.id, userId: auth.sub })
    if (!note) throw NotFound('voice_note_not_found', 'Voice note no longer exists.')
    if (!note.transcript) {
      throw BadRequest('voice_note_not_ready', 'Voice note transcript is not ready yet.')
    }

    // Caller-supplied timezone (already IANA-validated) wins; otherwise fall
    // back to the timezone captured with the note.
    const tz = parsedBody.data.timezone ?? note.timezone
    const drafts = await extractItems({ transcript: note.transcript, timezone: tz })
    const { autoSave, review, clarify } = gateAndKey(note.id, drafts)

    const created = await persistTasksFromItems({
      userId: note.userId,
      voiceNoteId: note._id,
      items: autoSave,
    })
    note.extractedTasks = autoSave.map((i) => toExtractedTask(i, created))
    note.reviewItems = review.map(toReviewItem)
    note.clarifyItems = clarify.map(draftToClarifyItem)
    // This route used to drop the clarify lane on the floor — it destructured
    // only {autoSave, review}, so a manual re-extract silently lost every
    // answerable question the worker path would have held. Idempotent via the
    // note-scoped key, so re-running never duplicates a question.
    await persistClarifications(note)
    note.status = review.length > 0 ? 'needs_review' : 'ready'
    await note.save()

    res.status(200).json({
      tasks: created.map((t) => t.toJSON()),
      voiceNote: note.toJSON(),
    })
  }),
)

// Commit a review pass: accept (optionally edited) held items → Tasks, discard
// the rest. Recomputes status to 'ready' once nothing is left to review.
const ReviewBodySchema = z.object({
  accepts: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().trim().min(1).max(240).optional(),
        domain: domainEnum.optional(),
        priority: priorityEnum.optional(),
        dueAt: z
          .string()
          .datetime()
          .transform((v) => new Date(v))
          .optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .default([]),
  discards: z.array(z.string().min(1)).default([]),
})

meVoiceNotesRouter.post(
  '/me/voice-notes/:id/review',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const note = await VoiceNote.findOne({ _id: req.params.id, userId: auth.sub })
    if (!note) throw NotFound('voice_note_not_found', 'Voice note no longer exists.')

    const parsed = ReviewBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_review', 'Invalid review payload.', parsed.error.flatten())
    }
    const { accepts, discards } = parsed.data

    const byKey = new Map(note.reviewItems.map((r) => [r.key, r]))
    const acceptedItems: ExtractedItem[] = []
    for (const accept of accepts) {
      const held = byKey.get(accept.key)
      if (!held) continue // already handled / stale — ignore idempotently
      acceptedItems.push({
        key: held.key,
        title: accept.title ?? held.title,
        domain: (accept.domain as ExtractedItem['domain']) ?? held.domain,
        priority: (accept.priority as ExtractedItem['priority']) ?? held.priority,
        confidence: 'high', // user-confirmed
        reviewReason: 'clear',
        reasons: [],
        // Carried, not re-derived — the estimate came from the extraction pass
        // that heard the transcript. The user retunes it afterwards via
        // PATCH /me/tasks/:id, which stamps source 'user'.
        estimate: held.estimate,
        dueAt: accept.dueAt ?? held.dueAt,
        notes: accept.notes ?? held.notes,
      })
    }

    const created = await persistTasksFromItems({
      userId: note.userId,
      voiceNoteId: note._id,
      items: acceptedItems,
    })

    const handledKeys = new Set<string>([...acceptedItems.map((i) => i.key), ...discards])
    const acceptedRecords = acceptedItems.map((i) => toExtractedTask(i, created))
    note.extractedTasks = [...note.extractedTasks, ...acceptedRecords]
    note.reviewItems = note.reviewItems.filter((r) => !handledKeys.has(r.key))

    if (note.reviewItems.length === 0) {
      note.status = 'ready'
      note.reviewedAt = new Date()
    }
    await note.save()

    res.status(200).json({
      tasks: created.map((t) => t.toJSON()),
      voiceNote: note.toJSON(),
    })
  }),
)

function toExtractedTask(
  item: ExtractedItem,
  created: { sourceTaskKey?: string; _id: Types.ObjectId }[],
): ExtractedTask {
  const match = created.find((t) => t.sourceTaskKey === item.key)
  return {
    key: item.key,
    title: item.title,
    domain: item.domain,
    priority: item.priority,
    confidence: item.confidence,
    reviewReason: item.reviewReason,
    estimate: item.estimate,
    dueAt: item.dueAt,
    notes: item.notes,
    taskId: match?._id,
  }
}

function toReviewItem(item: ExtractedItem): ReviewItem {
  return {
    key: item.key,
    title: item.title,
    domain: item.domain,
    priority: item.priority,
    confidence: item.confidence,
    reviewReason: item.reviewReason,
    reasons: item.reasons,
    estimate: item.estimate,
    dueRaw: item.dueRaw,
    dueAt: item.dueAt,
    notes: item.notes,
  }
}
