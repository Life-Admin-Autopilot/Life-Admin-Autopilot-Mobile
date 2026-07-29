import { Router, raw } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { buildStorageKey, getDocumentScanStorage } from '../lib/documentScanStorage'
import { countPdfPages } from '../lib/pdfPageCount'
import { enqueueDocumentScan } from '../lib/documentScanWorker'
import {
  admitDocumentScan,
  readDocumentScanQuota,
  releaseDocumentScanSlot,
} from '../lib/documentScanQuota'
import { requireAuth } from '../middleware/auth'
import { documentScanLimiter } from '../middleware/rateLimit'
import { logger } from '../logger'
import { Notification } from '../models/Notification'
import {
  MAX_MANUAL_SCAN_RETRIES,
  SCANNED_DOCUMENT_SOURCES,
  ScannedDocument,
  type ExtractedTaskCandidate,
} from '../models/ScannedDocument'
import { DOMAINS, User } from '../models/User'
import { TASK_PRIORITIES } from '../models/Task'
import { env } from '../env'
import { persistTasksFromCandidates } from '../modules/ai/documentCore/persist'
import type { ExtractedCandidate } from '../modules/ai/documentCore/contract'

export const meDocumentScansRouter = Router()

const domainEnum = z.enum([...DOMAINS] as [string, ...string[]])
const priorityEnum = z.enum([...TASK_PRIORITIES] as [string, ...string[]])

// Same "explicit-check ABOVE the raw() ceiling" pattern as me.voiceNotes.ts —
// the raw() limit sits above so a normal oversize hits the friendly 400 below
// instead of body-parser's terse 413.
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp']
const maxBytes = () => env().DOCUMENT_SCAN_MAX_BYTES
const maxMb = () => Math.round(maxBytes() / (1024 * 1024))

// Same reasoning as me.voiceNotes.ts's isValidIanaTimeZone check — validate at
// the request boundary so a bad zone 400s instead of crashing extraction.
function isValidIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const HeadersSchema = z.object({
  capturedAt: z
    .string()
    .datetime()
    .transform((v) => new Date(v)),
  source: z.enum(SCANNED_DOCUMENT_SOURCES).default('pdf'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine(isValidIanaTimeZone, { message: 'must be a valid IANA timezone' })
    .optional(),
})

meDocumentScansRouter.post(
  '/me/document-scans',
  requireAuth,
  documentScanLimiter,
  raw({ type: ALLOWED_MIME, limit: maxBytes() * 2 }),
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const bytes = req.body as Buffer | undefined
    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw BadRequest('empty_body', 'No document payload received.')
    }
    if (bytes.length > maxBytes()) {
      throw BadRequest('payload_too_large', `Document exceeds ${maxMb()}MB.`)
    }

    const contentType = (req.header('content-type') ?? '').split(';')[0]?.trim()
    if (!contentType || !ALLOWED_MIME.includes(contentType)) {
      throw BadRequest('unsupported_media_type', 'Only PDF, JPEG, PNG, HEIC, or WebP are supported.')
    }

    const meta = HeadersSchema.safeParse({
      capturedAt: req.header('x-document-scan-captured-at'),
      source: req.header('x-document-scan-source'),
      timezone: req.header('x-document-scan-timezone'),
    })
    if (!meta.success) {
      throw BadRequest('invalid_metadata', 'Missing or invalid x-document-scan-* headers.', meta.error.flatten())
    }

    // Hard page-count cap enforced BEFORE storage write — a PDF's page count
    // can only be known after a (cheap, non-rendering) parse.
    const pageCount = contentType === 'application/pdf' ? await countPdfPages(bytes) : 1
    if (pageCount > env().DOCUMENT_SCAN_MAX_PAGES) {
      throw BadRequest(
        'document_too_many_pages',
        `PDF has ${pageCount} pages, exceeding the ${env().DOCUMENT_SCAN_MAX_PAGES}-page limit.`,
      )
    }

    // Monthly quota reserved before the storage write; released below if
    // anything fails before the ScannedDocument is durably created.
    // Every user is free-tier for v1 (mirrors modules/ai/routes.ts resolveTier).
    const tier = 'free' as const
    await admitDocumentScan({ userId: auth.sub, tier })

    try {
      const id = new Types.ObjectId()
      const key = buildStorageKey(auth.sub, id.toHexString(), contentType)
      await getDocumentScanStorage().put(key, bytes)

      const doc = await ScannedDocument.create({
        _id: id,
        userId: auth.sub,
        storageKey: key,
        mimeType: contentType,
        sourceType: meta.data.source,
        pageCount,
        byteSize: bytes.length,
        status: 'pending',
        clientCapturedAt: meta.data.capturedAt,
        timezone: meta.data.timezone,
      })

      enqueueDocumentScan(doc.id)

      res.status(202).json({ scannedDocument: doc.toJSON() })
    } catch (err) {
      await releaseDocumentScanSlot({ userId: auth.sub })
      throw err
    }
  }),
)

meDocumentScansRouter.get(
  '/me/document-scans',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const docs = await ScannedDocument.find({ userId: auth.sub }).sort({ createdAt: -1 }).limit(50)
    res.status(200).json({ scannedDocuments: docs.map((d) => d.toJSON()) })
  }),
)

// MUST stay above `/:id` — Express matches in registration order, so the
// parameterised route would otherwise swallow "quota" as an id and 404.
meDocumentScansRouter.get(
  '/me/document-scans/quota',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const user = await User.findById(auth.sub).lean()
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    const tier = user.subscription?.tier ?? 'free'
    const quota = await readDocumentScanQuota({ userId: auth.sub, tier })
    res.status(200).json({ tier, quota })
  }),
)

meDocumentScansRouter.get(
  '/me/document-scans/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const doc = await ScannedDocument.findOne({ _id: req.params.id, userId: auth.sub })
    if (!doc) throw NotFound('scanned_document_not_found', 'Scanned document no longer exists.')
    res.status(200).json({ scannedDocument: doc.toJSON() })
  }),
)

// Streams the original scanned bytes (photo/PDF) for the simple in-app
// viewer — the only place storageKey is ever read back out; toJSON() strips
// it from every other response on purpose.
meDocumentScansRouter.get(
  '/me/document-scans/:id/file',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const doc = await ScannedDocument.findOne({ _id: req.params.id, userId: auth.sub })
    if (!doc) throw NotFound('scanned_document_not_found', 'Scanned document no longer exists.')
    const bytes = await getDocumentScanStorage().get(doc.storageKey)
    res.setHeader('Content-Type', doc.mimeType)
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.status(200).send(bytes)
  }),
)

// Permanently delete a scan: the stored bytes, the record, and any notification
// pointing at it. Irreversible by construction — the original file is gone, so
// there is nothing an undo could restore, and the client confirms before
// calling rather than offering an undo afterwards.
//
// Tasks already filed from this document are deliberately NOT touched. Once a
// candidate has been accepted it is a matter in its own right; deleting the
// scan it came from must never make matters disappear from the user's list.
//
// The monthly quota slot is deliberately NOT released either. The quota guards
// sustained AI cost, and the extraction call for this document has already been
// paid for — refunding on delete would make scan-then-delete an unlimited loop
// around the cap. releaseDocumentScanSlot() stays scoped to its original case:
// an upload that failed before any AI work happened.
meDocumentScansRouter.delete(
  '/me/document-scans/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const doc = await ScannedDocument.findOne({ _id: req.params.id, userId: auth.sub })
    // Idempotent: a second delete (double-tap, retry of a request that actually
    // succeeded) is a no-op success, not a 404 the client has to special-case
    // when deleting several at once.
    if (!doc) {
      res.status(204).end()
      return
    }

    const storageKey = doc.storageKey

    // Record first, bytes second. The reverse order can leave a row pointing at
    // a file that no longer exists, so opening the document 500s while it still
    // sits in the list — strictly worse than leaking a file on disk.
    await doc.deleteOne()
    await Notification.deleteMany({ userId: auth.sub, documentId: doc._id })

    try {
      await getDocumentScanStorage().remove(storageKey)
    } catch (err: unknown) {
      // Best-effort: an already-missing file must not fail a delete the user
      // has, from their side, already completed.
      logger.warn({ err, storageKey }, 'documentScan:delete-storage-failed')
    }

    res.status(204).end()
  }),
)

// Re-run extraction on a document that failed, from the bytes already in
// storage. The upload writes the file BEFORE the record (see the POST above),
// so a processing failure never costs the user their capture — retrying is a
// worker re-enqueue, not a second upload of a photo they'd have to retake.
//
// The monthly quota slot is deliberately NOT charged again, for the mirror of
// the reason DELETE doesn't refund one: the slot belongs to the DOCUMENT, not
// to an extraction attempt. Billing a retry would charge the user for our
// failure. `manualRetries` is what bounds the cost instead — the worker's own
// maxAttempts ladder guards transient errors, and this caps how many fresh
// ladders a retry button can buy.
meDocumentScansRouter.post(
  '/me/document-scans/:id/reprocess',
  requireAuth,
  documentScanLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const doc = await ScannedDocument.findOne({ _id: req.params.id, userId: auth.sub })
    if (!doc) throw NotFound('scanned_document_not_found', 'Scanned document no longer exists.')

    // Idempotent on any status that isn't actually failed. The client polls on
    // a 4s interval, so a retry tapped in the window where the worker already
    // recovered has to read as success — a 409 there would show the user an
    // error about a document that is fine.
    if (doc.status !== 'failed') {
      res.status(200).json({ scannedDocument: doc.toJSON() })
      return
    }

    if (doc.manualRetries >= MAX_MANUAL_SCAN_RETRIES) {
      throw BadRequest(
        'document_scan_retry_exhausted',
        "This document has failed too many times to keep retrying. Try scanning it again.",
      )
    }

    doc.manualRetries += 1
    // `attempts` resets so the transient-error backoff ladder starts fresh. A
    // document that exhausted maxAttempts during an outage an hour ago should
    // get a full ladder now, not a single last try that spends the retry on
    // whatever the first request happens to hit.
    doc.attempts = 0
    doc.status = 'pending'
    doc.nextRunAt = new Date()
    doc.lockedUntil = null
    doc.lastError = undefined
    doc.failureReason = undefined
    await doc.save()

    enqueueDocumentScan(doc.id)

    res.status(202).json({ scannedDocument: doc.toJSON() })
  }),
)

// Commit a review pass: accept (optionally edited) candidates -> Tasks, discard
// the rest. Every candidate requires an explicit accept/discard — nothing here
// was ever auto-saved, per the "draft for confirmation" product decision.
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

meDocumentScansRouter.post(
  '/me/document-scans/:id/review',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const doc = await ScannedDocument.findOne({ _id: req.params.id, userId: auth.sub })
    if (!doc) throw NotFound('scanned_document_not_found', 'Scanned document no longer exists.')
    if (doc.status !== 'ready_for_review') {
      throw BadRequest('scan_not_ready', 'This scan is not ready for review yet.')
    }

    const parsed = ReviewBodySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      throw BadRequest('invalid_review', 'Invalid review payload.', parsed.error.flatten())
    }
    const { accepts, discards } = parsed.data

    const byKey = new Map(doc.candidates.map((c) => [c.key, c]))
    const acceptedItems: ExtractedCandidate[] = []
    for (const accept of accepts) {
      const held = byKey.get(accept.key)
      if (!held) continue // already handled / stale — ignore idempotently
      acceptedItems.push({
        key: held.key,
        title: accept.title ?? held.title,
        domain: (accept.domain as ExtractedCandidate['domain']) ?? held.domain,
        priority: (accept.priority as ExtractedCandidate['priority']) ?? held.priority,
        confidence: held.confidence,
        // Carried, not re-derived — the estimate came from the vision pass that
        // read the document, and nothing at accept time knows more than it did.
        // The user retunes it afterwards via PATCH /me/tasks/:id.
        estimate: held.estimate,
        dueAt: accept.dueAt ?? held.dueAt,
        notes: accept.notes ?? held.notes,
        sourcePage: held.sourcePage,
      })
    }

    const created = await persistTasksFromCandidates({
      userId: doc.userId,
      documentId: doc._id,
      items: acceptedItems,
    })

    const handledKeys = new Set<string>([...acceptedItems.map((i) => i.key), ...discards])
    const idByKey = new Map(created.map((t) => [t.sourceTaskKey, t._id]))
    const acceptedRecords: ExtractedTaskCandidate[] = acceptedItems.map((i) => ({
      ...i,
      taskId: idByKey.get(i.key),
    }))

    doc.candidates = [
      ...doc.candidates.filter((c) => !handledKeys.has(c.key)),
      ...acceptedRecords,
    ]

    const remaining = doc.candidates.filter((c) => !c.taskId).length
    if (remaining === 0) doc.reviewedAt = new Date()
    await doc.save()

    res.status(200).json({
      tasks: created.map((t) => t.toJSON()),
      scannedDocument: doc.toJSON(),
    })
  }),
)
