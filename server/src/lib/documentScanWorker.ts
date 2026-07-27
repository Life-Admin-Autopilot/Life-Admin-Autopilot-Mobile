import { createHash } from 'node:crypto'
import { env } from '../env'
import { logger } from '../logger'
import {
  ScannedDocument,
  SCANNED_DOCUMENT_CLAIMABLE_STATUSES,
  type ExtractedTaskCandidate,
  type ScannedDocumentDoc,
} from '../models/ScannedDocument'
import { Notification } from '../models/Notification'
import { User } from '../models/User'
import { extractDocumentCandidates } from '../modules/ai/documentCore/extract'
import type { DraftCandidate } from '../modules/ai/documentCore/contract'
import { isTransientGeminiError } from '../modules/ai/voiceCore/geminiRetry'
import { getDocumentScanStorage } from './documentScanStorage'

// Async lock/lease worker for scanned documents — same shape as
// voiceNoteTranscriber.ts: claim -> process -> hold everything for review ->
// notify. No auto-save gate here (product decision): every extracted
// candidate lands in `candidates` for the user to accept/edit/discard.

const LOCK_MS = 180_000 // multi-page vision calls run longer than a single voice extraction
const WORKER_POLL_MS = 2_000
const BACKOFF_BASE_MS = 2_000
const BACKOFF_CAP_MS = 60_000

function backoffMs(attempts: number): number {
  const exp = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1))
  return exp + Math.floor(Math.random() * 1_000)
}

function makeCandidateKey(documentId: string, index: number, title: string): string {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ')
  return createHash('sha256').update(`${documentId}|${index}|${normalized}`).digest('hex').slice(0, 24)
}

function draftToCandidate(documentId: string, index: number, item: DraftCandidate): ExtractedTaskCandidate {
  return {
    key: makeCandidateKey(documentId, index, item.title),
    title: item.title,
    domain: item.domain,
    priority: item.priority,
    confidence: item.confidence,
    dueAt: item.dueAt,
    notes: item.notes,
    sourcePage: item.sourcePage,
  }
}

// Process a single claimed document end-to-end. Idempotent: a reclaim that
// finds candidates already staged does not re-run the (expensive) vision
// call — it just falls through to notify, matching voiceNoteTranscriber's
// recovery-path posture.
export async function processScannedDocument(doc: ScannedDocumentDoc): Promise<void> {
  try {
    if (doc.candidates.length === 0) {
      doc.attempts += 1
      doc.status = 'processing'
      doc.lockedUntil = new Date(Date.now() + LOCK_MS)
      await doc.save()

      const bytes = await getDocumentScanStorage().get(doc.storageKey)
      const extraction = await extractDocumentCandidates({
        bytes,
        mimeType: doc.mimeType,
        timezone: doc.timezone,
      })
      doc.candidates = extraction.candidates.map((c, i) => draftToCandidate(doc.id, i, c))
      doc.documentSummary = extraction.documentSummary
      // Row copy for the /documents list. Set even when the extraction found no
      // candidates — a scan with nothing actionable still has to name itself in
      // the list, and 'other' with no title is what the row falls back on.
      doc.documentType = extraction.documentType
      doc.documentTitle = extraction.documentTitle
      doc.documentSubtitle = extraction.documentSubtitle
      doc.issuer = extraction.issuer
    }

    doc.status = 'ready_for_review'
    doc.lockedUntil = null
    doc.lastError = undefined
    doc.failureReason = undefined
    await doc.save()

    await maybeNotify(doc)
  } catch (err: unknown) {
    await handleFailure(doc, err)
  }
}

async function handleFailure(doc: ScannedDocumentDoc, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  logger.error({ err, documentId: doc.id, attempts: doc.attempts }, 'documentScan:job-error')
  if (isTransientGeminiError(err) && doc.attempts < doc.maxAttempts) {
    doc.status = 'pending'
    doc.nextRunAt = new Date(Date.now() + backoffMs(doc.attempts))
    doc.lockedUntil = null
    doc.lastError = message
  } else {
    doc.status = 'failed'
    doc.failureReason = message
    doc.lastError = message
    doc.lockedUntil = null
  }
  await doc.save().catch(() => {
    /* save-on-failure is best-effort */
  })
}

async function maybeNotify(doc: ScannedDocumentDoc): Promise<void> {
  if (env().NODE_ENV === 'test') return
  if (doc.status !== 'ready_for_review') return
  if (doc.notifiedAt) return

  const user = await User.findById(doc.userId).select('notifications')
  if (user && user.notifications?.push !== false) {
    const count = doc.candidates.length
    await Notification.create({
      userId: doc.userId,
      kind: 'document_scan',
      documentId: doc._id,
      title: 'Scan ready to review',
      body:
        count === 0
          ? "We didn't find anything actionable in that scan."
          : count === 1
            ? '1 item found — take a look.'
            : `${count} items found — take a look.`,
    })
  }

  doc.notifiedAt = new Date()
  await doc.save().catch(() => {
    /* notifiedAt persistence is best-effort */
  })
}

// Atomically claim the next due document (or reclaim one whose lock expired
// after a crash). Mirrors voiceNoteTranscriber's claimNextNote exactly.
async function claimNextDocument(): Promise<ScannedDocumentDoc | null> {
  const now = new Date()
  return ScannedDocument.findOneAndUpdate(
    {
      status: { $in: [...SCANNED_DOCUMENT_CLAIMABLE_STATUSES] },
      nextRunAt: { $lte: now },
      $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }],
    },
    { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS) } },
    { sort: { nextRunAt: 1 }, new: true },
  )
}

async function runOnce(): Promise<boolean> {
  const doc = await claimNextDocument()
  if (!doc) return false
  await processScannedDocument(doc)
  return true
}

let workerTimer: ReturnType<typeof setInterval> | null = null

export function startDocumentScanWorker(): void {
  if (workerTimer) return
  if (env().NODE_ENV === 'test') return
  workerTimer = setInterval(() => {
    void runOnce().catch((err: unknown) => logger.error({ err }, 'documentScanWorker:tick-failed'))
  }, WORKER_POLL_MS)
  if (typeof workerTimer.unref === 'function') workerTimer.unref()
  logger.info('documentScanWorker:started')
}

export function stopDocumentScanWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer)
    workerTimer = null
  }
}

// Low-latency kick after an upload — claims + processes immediately rather
// than waiting for the next poll tick. Skipped in tests.
export function enqueueDocumentScan(documentId: string): void {
  if (env().NODE_ENV === 'test') return
  setImmediate(() => {
    void runOnce().catch((err: unknown) => logger.error({ err, documentId }, 'documentScanWorker:kick-failed'))
  })
}
