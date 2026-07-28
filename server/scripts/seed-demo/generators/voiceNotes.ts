import { Types } from 'mongoose'

import { buildStorageKey } from '../../../src/lib/voiceNoteStorage'
import { MESSY_TRANSCRIPTS, VOICE_TRANSCRIPTS } from '../catalog/phrasing'
import { PENDING, TIMEZONE, VOLUMES } from '../config'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'
import type { TaskSeed } from './taskFactory'

// Voice notes, and the lineage that ties them to the matters they produced.
//
// No audio bytes are written. Nothing in the client ever lists or plays a note
// — there is no queries/voiceNotes.ts — so a note exists here to give the
// matters it created a believable origin, and to populate the review lane.
// Writing 180 fake .m4a files would be work in service of a screen that
// doesn't exist.

// Every seeded note lands in a TERMINAL status. The worker claims on
// VOICE_NOTE_CLAIMABLE_STATUSES (pending/transcribing/extracting), so a note
// parked in any of those would be picked up on boot and re-run through Gemini.

export interface VoiceNoteResult {
  notes: SeedDoc[]
  /** Matters the notes claim credit for, mutated in place with the back-link. */
  attributed: TaskSeed[]
}

function bytesFor(durationMs: number): number {
  // Roughly what AAC at the app's standard quality comes out at.
  return Math.round((durationMs / 1000) * 4_200)
}

export function buildVoiceNotes(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  /** Candidate matters, in creation order. */
  tasks: TaskSeed[]
}): VoiceNoteResult {
  const { rng, userId, now, tasks } = args

  // Only matters that still exist and have a plausible spoken origin. Recurring
  // bills are excluded by the caller; what arrives here is one-offs and live
  // items, which is what someone actually dictates.
  const eligible = rng.shuffle(tasks.filter((t) => !t.deletedAt))

  const notes: SeedDoc[] = []
  const attributed: TaskSeed[] = []
  let cursor = 0

  for (let i = 0; i < VOLUMES.voiceNotes && cursor < eligible.length; i += 1) {
    const noteId = new Types.ObjectId()
    const batch = eligible.slice(cursor, cursor + rng.int(1, 3))
    cursor += batch.length
    if (batch.length === 0) break

    // The note was spoken just before the earliest matter it created.
    const earliest = Math.min(...batch.map((t) => t.createdAt.getTime()))
    const capturedAt = new Date(earliest - rng.int(60_000, 900_000))
    const durationMs = rng.int(3_500, 42_000)

    const needsReview = i < PENDING.voiceNotesNeedingReview
    const failed = i === PENDING.voiceNotesNeedingReview

    // A failed note transcribed nothing, so it can't claim credit for anything.
    // Decided BEFORE the back-links are written rather than undone afterwards.
    const extractedTasks = (failed ? [] : batch).map((task, n) => {
      const key = `${noteId.toHexString()}-${n}`
      task.sourceVoiceNoteId = noteId
      task.sourceTaskKey = key
      task.confidence = 'high'
      attributed.push(task)
      return {
        key,
        title: task.title,
        domain: task.domain,
        priority: (task.priority as string) ?? 'normal',
        confidence: 'high' as const,
        reviewReason: 'clear' as const,
        estimate: task.estimate,
        dueAt: task.dueAt,
        notes: task.notes,
        taskId: task._id,
      }
    })

    // Held items are NOT matters. They sit on the note until the user accepts
    // or discards them, which is the whole point of the review lane.
    const reviewItems = needsReview
      ? [
          {
            key: `${noteId.toHexString()}-held`,
            title: rng.pick([
              'Something about the bank',
              'Email that guy back',
              'The car thing',
              'Sort out the insurance',
            ]),
            domain: rng.pick(['finance', 'car', 'home', 'health'] as const),
            priority: 'normal',
            confidence: rng.pick(['medium', 'low'] as const),
            reviewReason: rng.pick(['ambiguous_intent', 'vague_date', 'incomplete'] as const),
            reasons: ['I could not tell what this should be called.'],
            dueRaw: rng.pick(['soon', 'next week sometime', 'before the end of the month']),
          },
        ]
      : []

    const status = failed ? 'failed' : needsReview ? 'needs_review' : 'ready'

    notes.push({
      _id: noteId,
      userId,
      storageKey: buildStorageKey(userId.toHexString(), noteId.toHexString()),
      durationMs,
      byteSize: bytesFor(durationMs),
      source: rng.weighted([
        ['app', 70],
        ['lock_screen', 15],
        ['widget', 10],
        ['dynamic_island', 5],
      ] as const),
      status,
      transcript: failed
        ? undefined
        : needsReview
          ? rng.pick(MESSY_TRANSCRIPTS)
          : rng.pick(VOICE_TRANSCRIPTS),
      failureReason: failed ? 'The recording was too quiet to make out.' : undefined,
      extractedTasks,
      reviewItems,
      clarifyItems: [],
      clientCapturedAt: capturedAt,
      timezone: TIMEZONE,
      mimeType: 'audio/m4a',
      attempts: failed ? 4 : 1,
      maxAttempts: 4,
      lockedUntil: null,
      nextRunAt: capturedAt,
      lastError: failed ? 'transcribe:low-signal' : undefined,
      reviewedAt: status === 'ready' ? new Date(capturedAt.getTime() + rng.int(30_000, 600_000)) : undefined,
      notifiedAt: new Date(capturedAt.getTime() + rng.int(20_000, 120_000)),
      createdAt: capturedAt,
      updatedAt: new Date(Math.min(capturedAt.getTime() + rng.int(60_000, 900_000), now.getTime())),
    })
  }

  return { notes, attributed }
}
