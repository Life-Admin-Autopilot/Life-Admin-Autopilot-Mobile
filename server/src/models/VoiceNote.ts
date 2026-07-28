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
import {
  CLARIFICATION_COSTS,
  CLARIFICATION_KINDS,
  type ClarificationCost,
  type ClarificationKind,
} from './Clarification'

export { CONFIDENCE_BUCKETS, type ConfidenceBucket }

export const VOICE_NOTE_STATUSES = [
  'pending',
  'transcribing',
  'extracting',
  'ready',
  'needs_review',
  'failed',
] as const
export type VoiceNoteStatus = (typeof VOICE_NOTE_STATUSES)[number]

// Terminal = nothing more the worker will do unprompted.
export const VOICE_NOTE_TERMINAL_STATUSES: readonly VoiceNoteStatus[] = [
  'ready',
  'needs_review',
  'failed',
]
// Statuses a crashed/expired-lock job can be reclaimed from. CRITICAL: this
// must include the in-progress states, not just 'pending' — otherwise a crash
// mid-transcribe strands the note in 'transcribing' forever (the exact failure
// the Mongo-backed worker exists to avoid).
export const VOICE_NOTE_CLAIMABLE_STATUSES: readonly VoiceNoteStatus[] = [
  'pending',
  'transcribing',
  'extracting',
]

export const VOICE_NOTE_SOURCES = ['app', 'widget', 'dynamic_island', 'lock_screen'] as const
export type VoiceNoteSource = (typeof VOICE_NOTE_SOURCES)[number]

// CONFIDENCE_BUCKETS lives in Task.ts (re-exported above) — 'high' + reviewReason
// 'clear' auto-saves; anything else is held for the user to accept/edit/discard.

// Why an item was held (or 'clear' if it wasn't). Drives the plain-language
// "why am I seeing this" line on the review card.
export const REVIEW_REASONS = [
  'clear',
  'ambiguous_intent',
  'vague_date',
  'maybe_duplicate',
  'incomplete',
  'low_asr',
  'unknown_domain',
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

// Auto-saved task record kept on the note for audit + undo. Mirrors the Task
// that was created; `taskId` back-links to it.
export interface ExtractedTask {
  key: string
  title: string
  domain: Domain
  priority: TaskPriority
  confidence: ConfidenceBucket
  reviewReason: ReviewReason
  // Carried from extraction so the estimate survives the review hold and lands
  // on the Task — re-deriving it at accept time would cost a second AI call for
  // an answer already given.
  estimate?: TaskEstimate
  dueAt?: Date
  notes?: string
  taskId?: Types.ObjectId
}

// Held-for-review item — NOT yet a Task. Lives on the note until the user
// accepts (→ Task), edits, or discards it.
export interface ReviewItem {
  key: string
  title: string
  domain: Domain
  priority: TaskPriority
  confidence: ConfidenceBucket
  reviewReason: ReviewReason
  reasons: string[]
  estimate?: TaskEstimate
  dueRaw?: string
  dueAt?: Date
  notes?: string
}

// A clarifiable hold from a voice note — an answerable question (conflicting
// date, missing-time-that-matters, unnameable). Stored on the note so a worker
// reclaim re-creates the SAME held Clarification idempotently (keyed by `key`).
// Distinct from ReviewItem: this carries a question + pre-resolved options and
// surfaces on the home banner → /clarify slider, not the voice-review screen.
export interface ClarifyItem {
  key: string
  title: string
  domain: Domain
  priority: TaskPriority
  question: string
  kind: ClarificationKind
  // Decides whether the task staged alongside this question gets a live
  // reminder or one withheld until the user confirms the date.
  costOfWrong: ClarificationCost
  options: { label: string; dueAt?: Date }[]
  notes?: string
}

export interface VoiceNoteAttrs {
  userId: Types.ObjectId
  storageKey: string
  durationMs: number
  byteSize: number
  source: VoiceNoteSource
  status: VoiceNoteStatus
  transcript?: string
  failureReason?: string
  extractedTasks: ExtractedTask[]
  reviewItems: ReviewItem[]
  clarifyItems: ClarifyItem[]
  clientCapturedAt: Date
  timezone?: string
  mimeType?: string
  // Job machinery (Mongo-backed worker). Never sent to the client.
  attempts: number
  maxAttempts: number
  lockedUntil: Date | null
  nextRunAt: Date
  lastError?: string
  reviewedAt?: Date
  notifiedAt: Date | null
}

const ExtractedTaskSchema = new Schema<ExtractedTask>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    domain: { type: String, enum: DOMAINS, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS, default: 'high' },
    reviewReason: { type: String, enum: REVIEW_REASONS, default: 'clear' },
    estimate: { type: EstimateSchema },
    dueAt: { type: Date },
    notes: { type: String },
    taskId: { type: Schema.Types.ObjectId, ref: 'Task' },
  },
  { _id: false },
)

const ReviewItemSchema = new Schema<ReviewItem>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    domain: { type: String, enum: DOMAINS, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS, default: 'medium' },
    reviewReason: { type: String, enum: REVIEW_REASONS, default: 'ambiguous_intent' },
    reasons: { type: [String], default: [] },
    estimate: { type: EstimateSchema },
    dueRaw: { type: String },
    dueAt: { type: Date },
    notes: { type: String },
  },
  { _id: false },
)

const ClarifyItemOptionSchema = new Schema<{ label: string; dueAt?: Date }>(
  {
    label: { type: String, required: true },
    dueAt: { type: Date },
  },
  { _id: false },
)

const ClarifyItemSchema = new Schema<ClarifyItem>(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    domain: { type: String, enum: DOMAINS, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    question: { type: String, required: true },
    kind: { type: String, enum: CLARIFICATION_KINDS, default: 'date' },
    costOfWrong: { type: String, enum: CLARIFICATION_COSTS, default: 'high' },
    options: { type: [ClarifyItemOptionSchema], default: [] },
    notes: { type: String },
  },
  { _id: false },
)

const VoiceNoteSchema = new Schema<VoiceNoteAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    storageKey: { type: String, required: true },
    durationMs: { type: Number, required: true, min: 0 },
    byteSize: { type: Number, required: true, min: 0 },
    source: { type: String, enum: VOICE_NOTE_SOURCES, default: 'app' },
    status: { type: String, enum: VOICE_NOTE_STATUSES, default: 'pending', index: true },
    transcript: { type: String },
    failureReason: { type: String },
    extractedTasks: { type: [ExtractedTaskSchema], default: [] },
    reviewItems: { type: [ReviewItemSchema], default: [] },
    clarifyItems: { type: [ClarifyItemSchema], default: [] },
    clientCapturedAt: { type: Date, required: true },
    timezone: { type: String },
    mimeType: { type: String },
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
        // Never leak storage location or internal job machinery to clients.
        delete ret.storageKey
        delete ret.attempts
        delete ret.maxAttempts
        delete ret.lockedUntil
        delete ret.nextRunAt
        delete ret.lastError
        delete ret.notifiedAt
        // clarifyItems are an internal staging lane — they surface to the client
        // as Clarifications (own endpoint), not on the voice-note payload.
        delete ret.clarifyItems
        return ret
      },
    },
  },
)

VoiceNoteSchema.index({ userId: 1, createdAt: -1 })
// Drives the worker's atomic claim query.
VoiceNoteSchema.index({ status: 1, nextRunAt: 1, lockedUntil: 1 })

export type VoiceNoteDoc = HydratedDocument<VoiceNoteAttrs>
type VoiceNoteModel = Model<VoiceNoteAttrs>

export const VoiceNote: VoiceNoteModel =
  (mongoose.models.VoiceNote as VoiceNoteModel | undefined) ??
  mongoose.model<VoiceNoteAttrs>('VoiceNote', VoiceNoteSchema)
