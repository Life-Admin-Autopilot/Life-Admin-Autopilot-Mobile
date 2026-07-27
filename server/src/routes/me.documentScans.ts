import { Router, raw } from 'express'
import { Types } from 'mongoose'
import { z } from 'zod'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { buildStorageKey, getDocumentScanStorage } from '../lib/documentScanStorage'
import { countPdfPages } from '../lib/pdfPageCount'
import { enqueueDocumentScan } from '../lib/documentScanWorker'
import { admitDocumentScan, releaseDocumentScanSlot } from '../lib/documentScanQuota'
import { requireAuth } from '../middleware/auth'
import { documentScanLimiter } from '../middleware/rateLimit'
import {
  SCANNED_DOCUMENT_SOURCES,
  ScannedDocument,
  type ExtractedTaskCandidate,
} from '../models/ScannedDocument'
import { DOMAINS } from '../models/User'
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
