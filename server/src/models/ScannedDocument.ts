import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { DOMAINS, type Domain } from './User'
import { TASK_PRIORITIES, type TaskPriority, CONFIDENCE_BUCKETS, type ConfidenceBucket } from './Task'

export { CONFIDENCE_BUCKETS, type ConfidenceBucket }

export const SCANNED_DOCUMENT_STATUSES = [
  'pending',
  'processing',
  'ready_for_review',
  'failed',
] as const
export type ScannedDocumentStatus = (typeof SCANNED_DOCUMENT_STATUSES)[number]

export const SCANNED_DOCUMENT_TERMINAL_STATUSES: readonly ScannedDocumentStatus[] = [
  'ready_for_review',
  'failed',
]
// Claimable includes the in-progress state so a crash mid-processing is
// recoverable — same rationale as VOICE_NOTE_CLAIMABLE_STATUSES.
export const SCANNED_DOCUMENT_CLAIMABLE_STATUSES: readonly ScannedDocumentStatus[] = [
  'pending',
  'processing',
]

export const SCANNED_DOCUMENT_SOURCES = ['camera', 'pdf', 'gallery'] as const
export type ScannedDocumentSource = (typeof SCANNED_DOCUMENT_SOURCES)[number]

// Every scanned-document item is held for the user to accept/edit/discard —
// per product decision, nothing auto-saves from a scan the way a high-
// confidence voice item does. Confidence is still carried for the review UI
// ("how sure is the agent"), it just never bypasses review.
export interface ExtractedTaskCandidate {
  key: string
  title: string
  domain: Domain
  priority: TaskPriority
  confidence: ConfidenceBucket
  dueAt?: Date
  notes?: string
  sourcePage?: number
  taskId?: Types.ObjectId
}

export interface ScannedDocumentAttrs {
  userId: Types.ObjectId
  storageKey: string
  mimeType: string
  sourceType: ScannedDocumentSource
  pageCount: number
  byteSize: number
  status: ScannedDocumentStatus
  rawExtractedText?: string
  failureReason?: string
  /** One-to-two-sentence AI-generated overview of the document itself (what
   *  it is, sender, key facts) — set once extraction completes. */
  documentSummary?: string
  candidates: ExtractedTaskCandidate[]
  clientCapturedAt: Date
  timezone?: string
  // Job machinery (Mongo-backed worker). Never sent to the client.
  attempts: number
  maxAttempts: number
  lockedUntil: Date | null
  nextRunAt: Date
  lastError?: string
  reviewedAt?: Date
  notifiedAt: Date | null
}

const ExtractedTaskCandidateSchema = new Schema<ExtractedTaskCandidate>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    domain: { type: String, enum: DOMAINS, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS, default: 'medium' },
    dueAt: { type: Date },
    notes: { type: String },
    sourcePage: { type: Number },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
  },
  { _id: false },
)

const ScannedDocumentSchema = new Schema<ScannedDocumentAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    storageKey: { type: String, required: true },
    mimeType: { type: String, required: true },
    sourceType: { type: String, enum: SCANNED_DOCUMENT_SOURCES, default: 'pdf' },
    pageCount: { type: Number, required: true, min: 1 },
    byteSize: { type: Number, required: true, min: 0 },
    status: { type: String, enum: SCANNED_DOCUMENT_STATUSES, default: 'pending', index: true },
    rawExtractedText: { type: String },
    failureReason: { type: String },
    documentSummary: { type: String },
    candidates: { type: [ExtractedTaskCandidateSchema], default: [] },
    clientCapturedAt: { type: Date, required: true },
    timezone: { type: String },
    // Job machinery
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    lockedUntil: { type: Date, default: null },
    nextRunAt: { type: Date, default: () => new Date(), index: true },
    lastError: { type: String },
    reviewedAt: { type: Date },
    notifiedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        // Never leak storage location, raw OCR text, or job machinery to clients.
        delete ret.storageKey
        delete ret.rawExtractedText
        delete ret.attempts
        delete ret.maxAttempts
        delete ret.lockedUntil
        delete ret.nextRunAt
        delete ret.lastError
        delete ret.notifiedAt
        return ret
      },
    },
  },
)

ScannedDocumentSchema.index({ userId: 1, createdAt: -1 })
// Drives the worker's atomic claim query.
ScannedDocumentSchema.index({ status: 1, nextRunAt: 1, lockedUntil: 1 })

export type ScannedDocumentDoc = HydratedDocument<ScannedDocumentAttrs>
type ScannedDocumentModel = Model<ScannedDocumentAttrs>

export const ScannedDocument: ScannedDocumentModel =
  (mongoose.models.ScannedDocument as ScannedDocumentModel | undefined) ??
  mongoose.model<ScannedDocumentAttrs>('ScannedDocument', ScannedDocumentSchema)
