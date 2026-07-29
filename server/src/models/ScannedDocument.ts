import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { DOMAINS, type Domain } from './User'
import {
  TASK_PRIORITIES,
  type TaskPriority,
  CONFIDENCE_BUCKETS,
  type ConfidenceBucket,
  EstimateSchema,
  type TaskEstimate,
} from './Task'

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

// How many times a user may hand-restart extraction on a document that has
// already failed terminally. Lives here rather than in the route because the
// `canRetry` flag toJSON() derives from it has to agree with the gate the route
// enforces — one constant, so the button can never be offered for a retry the
// server will refuse.
export const MAX_MANUAL_SCAN_RETRIES = 3

// What the document IS, not what it asks of you — a bill you've already paid is
// still a bill. Drives the leading icon on the /documents row, so the set is
// deliberately small enough that every value maps to a glyph a user can learn.
// `other` is the honest fallback; a misclassified icon is worse than a generic
// one.
export const DOCUMENT_TYPES = [
  'bill',
  'statement',
  'letter',
  'form',
  'receipt',
  'insurance',
  'medical',
  'legal',
  'identity',
  'tax',
  'other',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// Row-copy budgets. Enforced server-side (the model is asked to respect them
// but is not trusted to) so the list row can rely on a bounded string rather
// than defending against a paragraph arriving in a title slot.
export const DOCUMENT_TITLE_MAX = 60
export const DOCUMENT_SUBTITLE_MAX = 120
export const DOCUMENT_ISSUER_MAX = 80

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
  // Carried across the review hold so the estimate the vision pass produced is
  // the one that lands on the Task — re-deriving it at accept time would mean a
  // second AI call for an answer we already have.
  estimate?: TaskEstimate
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
   *  it is, sender, key facts) — set once extraction completes. Feeds the
   *  detail surfaces (review card, task overview), NOT the list row. */
  documentSummary?: string
  /** Document kind, for the list row's leading icon. */
  documentType?: DocumentType
  /** Short noun-phrase headline for the list row ("Electricity bill"). Kept
   *  separate from `documentSummary` because a truncated prose sentence spends
   *  the visible half of the row on preamble and cuts the actual fact. */
  documentTitle?: string
  /** One-line description for the list row, written most-important-token-first
   *  so it survives truncation ("Due July 30 · $142.37"). */
  documentSubtitle?: string
  /** Organization or person the document came from ("City Power"). */
  issuer?: string
  candidates: ExtractedTaskCandidate[]
  clientCapturedAt: Date
  timezone?: string
  // Job machinery (Mongo-backed worker). Never sent to the client.
  attempts: number
  maxAttempts: number
  /** How many times the USER has hand-restarted extraction after a terminal
   *  failure (POST /:id/reprocess). `attempts`/`maxAttempts` bound one automatic
   *  ladder; this bounds how many ladders a retry button can buy, so a stuck
   *  document can't become an unbounded spend loop around the monthly quota. */
  manualRetries: number
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
    estimate: { type: EstimateSchema },
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
    documentType: { type: String, enum: DOCUMENT_TYPES },
    documentTitle: { type: String, maxlength: DOCUMENT_TITLE_MAX },
    documentSubtitle: { type: String, maxlength: DOCUMENT_SUBTITLE_MAX },
    issuer: { type: String, maxlength: DOCUMENT_ISSUER_MAX },
    candidates: { type: [ExtractedTaskCandidateSchema], default: [] },
    clientCapturedAt: { type: Date, required: true },
    timezone: { type: String },
    // Job machinery
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 4 },
    manualRetries: { type: Number, default: 0 },
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
        // The retry budget is machinery, but WHETHER a retry is still on the
        // table is product state the error screen needs — derive the boolean
        // here so the client never has to know the counter or the cap.
        ret.canRetry =
          ret.status === 'failed' && Number(ret.manualRetries ?? 0) < MAX_MANUAL_SCAN_RETRIES
        // Never leak storage location, raw OCR text, or job machinery to clients.
        delete ret.storageKey
        delete ret.rawExtractedText
        delete ret.attempts
        delete ret.maxAttempts
        delete ret.manualRetries
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
