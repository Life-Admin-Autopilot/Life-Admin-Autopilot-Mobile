import { env } from '../env'
import { logger } from '../logger'
import {
  VoiceNote,
  VOICE_NOTE_CLAIMABLE_STATUSES,
  type ClarifyItem,
  type ExtractedTask,
  type ReviewItem,
  type VoiceNoteDoc,
} from '../models/VoiceNote'
import type { TaskDoc } from '../models/Task'
import { transcribeAudio } from '../modules/ai/audioTranscriber'
import { getUserAiLocale } from '../modules/ai/userLocale'
import { extractItems } from '../modules/ai/voiceCore/extract'
import { gateAndKey } from '../modules/ai/voiceCore/gate'
import { persistTasksFromItems } from '../modules/ai/voiceCore/persist'
import { upsertVoiceClarification } from '../modules/clarifications/upsertVoiceClarification'
import { isTransientGeminiError } from '../modules/ai/voiceCore/geminiRetry'
import type { DraftItem, ExtractedItem } from '../modules/ai/voiceCore/contract'
import { getVoiceNoteStorage } from './voiceNoteStorage'
import { recordVoiceNoteNotification } from './voiceNoteNotification'

// The real voice pipeline (replaces the old hardcoded stub). For each note:
//   transcribe (Gemini) -> extract (confidence-scored) -> gate -> persist the
//   confident tasks -> hold the uncertain ones for review -> finalize status.
//
// Durability: jobs live on the VoiceNote document. A single in-process worker
// claims notes atomically and re-claims any whose lock expired (crash recovery).
// No external queue — the status + idempotency live on the doc, so swapping in
// BullMQ/Agenda later is mechanical.

const LOCK_MS = 120_000 // > worst-case transcribe+extract for a 20-intent note
const WORKER_POLL_MS = 2_000
const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 60_000

function backoffMs(attempts: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
  return exp + Math.floor(Math.random() * 1_000)
}

function draftToReviewItem(item: ExtractedItem): ReviewItem {
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

function draftToExtractedTask(item: ExtractedItem): ExtractedTask {
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
  }
}

// Clarify-lane item → the staged ClarifyItem persisted on the note. Only called
// for items the gate routed to `clarify`, so `clarification` is always set.
export function draftToClarifyItem(item: ExtractedItem): ClarifyItem {
  const c = item.clarification
  if (!c) throw new Error('draftToClarifyItem called on a non-clarify item')
  return {
    key: item.key,
    title: item.title,
    domain: item.domain,
    priority: item.priority,
    question: c.question,
    kind: c.kind,
    costOfWrong: c.costOfWrong,
    options: c.options.map((o) => ({ label: o.label, dueAt: o.dueAt })),
    notes: item.notes,
  }
}

function recordToItem(record: ExtractedTask): ExtractedItem {
  return {
    key: record.key,
    title: record.title,
    domain: record.domain,
    priority: record.priority,
    confidence: record.confidence,
    reviewReason: record.reviewReason,
    reasons: [],
    estimate: record.estimate,
    dueAt: record.dueAt,
    notes: record.notes,
  }
}

// Process a single claimed note end-to-end. Idempotent: a retry/reclaim that
// finds extraction already stored re-persists from it (never re-transcribes —
// LLM nondeterminism would shift the idempotency keys).
export async function processVoiceNote(note: VoiceNoteDoc): Promise<void> {
  try {
    const hasExtraction =
      Boolean(note.transcript) &&
      (note.extractedTasks.length > 0 ||
        note.reviewItems.length > 0 ||
        note.clarifyItems.length > 0)

    let autoSaveItems: ExtractedItem[]

    if (hasExtraction) {
      // Recovery path — re-persist from what we already extracted. clarifyItems
      // are already staged on the note; persistClarifications re-upserts them.
      autoSaveItems = note.extractedTasks.map(recordToItem)
    } else {
      // Genuine fresh start: this is the only place a retry attempt is spent.
      // Claiming/reclaiming the note (lock acquisition) must NOT burn an attempt
      // — otherwise a crash or lock-expiry reclaim eats the retry budget and a
      // note can be marked 'failed' without ever genuinely failing maxAttempts
      // times. Reclaiming the SAME in-progress note re-enters here and counts as
      // a real attempt, which is correct (we're re-transcribing from scratch).
      note.attempts += 1
      note.status = 'transcribing'
      note.lockedUntil = new Date(Date.now() + LOCK_MS)
      await note.save()

      const bytes = await getVoiceNoteStorage().get(note.storageKey)
      const locale = await getUserAiLocale(String(note.userId))
      const transcript = await transcribeAudio({
        bytes,
        mimeType: note.mimeType ?? 'audio/m4a',
        locale,
      })
      note.transcript = transcript

      note.status = 'extracting'
      note.lockedUntil = new Date(Date.now() + LOCK_MS)
      await note.save()

      const drafts: DraftItem[] = transcript.trim()
        ? await extractItems({ transcript, timezone: note.timezone, locale })
        : []
      const { autoSave, review, clarify } = gateAndKey(note.id, drafts)
      autoSaveItems = autoSave
      note.extractedTasks = autoSave.map(draftToExtractedTask)
      note.reviewItems = review.map(draftToReviewItem)
      note.clarifyItems = clarify.map(draftToClarifyItem)
    }

    const created = await persistTasksFromItems({
      userId: note.userId,
      voiceNoteId: note._id,
      items: autoSaveItems,
    })
    backlinkTaskIds(note, created)

    // Hold the answerable items as Clarifications (home banner → /clarify
    // slider). Idempotent per (user, item key) so a reclaim never duplicates.
    await persistClarifications(note)

    note.status = note.reviewItems.length > 0 ? 'needs_review' : 'ready'
    note.lockedUntil = null
    note.lastError = undefined
    note.failureReason = undefined
    await note.save()

    await maybeNotify(note)
  } catch (err: unknown) {
    await handleFailure(note, err)
  }
}

// Upsert one held Clarification per staged clarify item. Idempotent via the
// note-scoped item key (partial unique index on {userId, sourceKey}), so a
// reclaim/retry re-running this never duplicates a question and never reopens
// one the user already answered. Sequential (not Promise.all) — the lists are
// tiny and this keeps Mongo write pressure flat.
export async function persistClarifications(note: VoiceNoteDoc): Promise<void> {
  for (const item of note.clarifyItems) {
    // The task comes FIRST and always. A held item used to be a draft with no
    // task behind it, so a captured thought sat invisible until answered —
    // absent from Matters, unsearchable, and untouched by "delete everything".
    // The first option is the model's most-likely guess (it orders them), so it
    // becomes the provisional date.
    const guess = item.options[0]?.dueAt ?? undefined
    const [task] = await persistTasksFromItems({
      userId: note.userId,
      voiceNoteId: note._id,
      items: [
        {
          key: item.key,
          title: item.title,
          domain: item.domain,
          priority: item.priority,
          confidence: 'low',
          reviewReason: 'vague_date',
          reasons: [],
          notes: item.notes,
          ...(guess ? { dueAt: guess } : {}),
        },
      ],
    })
    if (!task) continue

    await upsertVoiceClarification({
      userId: note.userId,
      taskId: task._id,
      sourceKey: item.key,
      draft: {
        title: item.title,
        domain: item.domain,
        priority: item.priority,
        notes: item.notes,
        dueAt: guess,
      },
      question: item.question,
      kind: item.kind,
      costOfWrong: item.costOfWrong,
      options: item.options.map((o) => ({ label: o.label, dueAt: o.dueAt ?? undefined })),
      // The whole transcript, not a per-item slice: extraction returns titles
      // and questions, never the span of speech each one came from, and a
      // guessed slice would quote the user saying something they didn't.
      sourceText: note.transcript,
    })
  }
}

function backlinkTaskIds(note: VoiceNoteDoc, created: TaskDoc[]): void {
  if (created.length === 0) return
  const idByKey = new Map(created.map((t) => [t.sourceTaskKey, t._id]))
  note.extractedTasks = note.extractedTasks.map((et) => ({
    ...et,
    taskId: idByKey.get(et.key) ?? et.taskId,
  }))
}

async function handleFailure(note: VoiceNoteDoc, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  logger.error({ err, noteId: note.id, attempts: note.attempts }, 'voiceNote:job-error')
  if (isTransientGeminiError(err) && note.attempts < note.maxAttempts) {
    note.status = 'pending'
    note.nextRunAt = new Date(Date.now() + backoffMs(note.attempts))
    note.lockedUntil = null
    note.lastError = message
  } else {
    note.status = 'failed'
    note.failureReason = message
    note.lastError = message
    note.lockedUntil = null
  }
  await note.save().catch(() => {
    /* save-on-failure is best-effort */
  })
}

// Always-surface push (product rule): 'needs_review' -> "N need a look",
// Writes the completion row to the in-app feed. Outbox guard via notifiedAt so
// a crash between commit and write re-sends rather than double-sends.
async function maybeNotify(note: VoiceNoteDoc): Promise<void> {
  if (env().NODE_ENV === 'test') return
  if (note.status !== 'needs_review' && note.status !== 'ready') return
  if (note.notifiedAt) return
  await recordVoiceNoteNotification(note)
  note.notifiedAt = new Date()
  await note.save().catch(() => {
    /* notifiedAt persistence is best-effort */
  })
}

// Atomically claim the next due note (or reclaim one whose lock expired after a
// crash). Claimable statuses include the in-progress states so a crash mid-job
// is recoverable, not stranded.
//
// The claim ONLY takes the lock — it never touches `attempts`. The retry
// counter is the failure budget, not a claim counter: it is incremented inside
// processVoiceNote at the genuine fresh-start of work (and bumped on transient
// failure via handleFailure's backoff path). Incrementing here would let a
// crash/lock-expiry reclaim silently burn a retry attempt.
async function claimNextNote(): Promise<VoiceNoteDoc | null> {
  const now = new Date()
  return VoiceNote.findOneAndUpdate(
    {
      status: { $in: [...VOICE_NOTE_CLAIMABLE_STATUSES] },
      nextRunAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    {
      $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    },
    { sort: { nextRunAt: 1 }, new: true },
  )
}

async function runOnce(): Promise<boolean> {
  const note = await claimNextNote()
  if (!note) return false
  await processVoiceNote(note)
  return true
}

let workerTimer: ReturnType<typeof setInterval> | null = null

export function startVoiceWorker(): void {
  if (workerTimer) return
  if (env().NODE_ENV === 'test') return
  workerTimer = setInterval(() => {
    void runOnce().catch((err: unknown) => logger.error({ err }, 'voiceWorker:tick-failed'))
  }, WORKER_POLL_MS)
  if (typeof workerTimer.unref === 'function') workerTimer.unref()
  logger.info('voiceWorker:started')
}

export function stopVoiceWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
}

// Low-latency kick after an upload — claims + processes immediately rather than
// waiting for the next poll tick. Skipped in tests (which drive processVoiceNote
// directly for determinism — no setImmediate races against assertions).
export function enqueueTranscription(noteId: string): void {
  if (env().NODE_ENV === 'test') return
  setImmediate(() => {
    void runOnce().catch((err: unknown) => logger.error({ err, noteId }, 'voiceWorker:kick-failed'))
  })
}
