import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { DOMAINS, type Domain } from './User'

export const TASK_STATUSES = ['open', 'done', 'snoozed'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

// The two shapes a matter can take. The distinction is load-bearing: a
// `reminder` exists to FIRE at a moment, so it MUST carry a dueAt (enforced
// below) — a dateless reminder is a silently-broken promise. A `list` item is
// passive: it lives on the home list and never fires, so a date is optional.
// The chat agent picks the kind per item; the server guarantees the invariant.
export const TASK_KINDS = ['reminder', 'list'] as const
export type TaskKind = (typeof TASK_KINDS)[number]

// Confidence a voice-extracted task carried when it was created. Defined here
// (not in VoiceNote) so VoiceNote can import it without a circular dependency —
// VoiceNote already depends on Task for TASK_PRIORITIES.
export const CONFIDENCE_BUCKETS = ['high', 'medium', 'low'] as const
export type ConfidenceBucket = (typeof CONFIDENCE_BUCKETS)[number]

// Numeric weights used for sort order — higher = earlier in the list.
// Surfaced via toJSON's `priorityRank` field so the client can sort/compare.
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
}

export interface SubtaskAttrs {
  _id?: Types.ObjectId
  text: string
  done: boolean
  createdAt?: Date
}

// Scheduled notification moments for a reminder task. Generated from the
// lead-time table (and optionally refined by AI). `firedAt` is the double-send
// guard — the reminder worker only fires entries with `firedAt == null`.
//   lead = the smart heads-up before due · due = at the deadline · ai = refined
export const REMINDER_KINDS = ['lead', 'due', 'ai'] as const
export type ReminderKind = (typeof REMINDER_KINDS)[number]

export interface ReminderEntry {
  at: Date
  firedAt?: Date
  kind: ReminderKind
}

export const MAX_SUBTASKS = 50
export const MAX_SUBTASK_TEXT = 240

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 32

// Normalize a tag — trim, lowercase, collapse whitespace to single hyphens,
// strip everything except lowercase alphanumerics and `-`. Returns null
// when the result would be empty.
export function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (cleaned.length === 0) return null
  return cleaned.slice(0, MAX_TAG_LENGTH)
}

export interface TaskAttrs {
  userId: Types.ObjectId
  title: string
  domain: Domain
  kind: TaskKind
  status: TaskStatus
  priority: TaskPriority
  subtasks: SubtaskAttrs[]
  tags: string[]
  dueAt?: Date
  notes?: string
  sourceVoiceNoteId?: Types.ObjectId
  sourceDocumentId?: Types.ObjectId
  // Stable per-(note,item) key for voice-extracted tasks. Powers idempotent
  // upserts so a worker retry / job reclaim never double-creates a task.
  sourceTaskKey?: string
  confidence?: ConfidenceBucket
  completedAt?: Date
  snoozedUntil?: Date
  // Scheduled reminder moments (smart lead-time + at-due). Regenerated whenever
  // a reminder task's dueAt/kind changes; the reminder worker fires un-fired ones.
  reminders: ReminderEntry[]
}

// Shared toJSON transform — surface a string `id` and hide Mongo internals.
// Mongoose does NOT apply a parent schema's transform to its embedded
// subdocuments, so the subtask schema needs its own copy. Without it, subtasks
// serialize with `_id` and no `id`, which breaks React list keys (`key={sub.id}`
// becomes `undefined`) and subtask mutate-by-id on the client (`subtaskId`
// becomes `undefined` → server 404 "subtask not found").
function toIdJSON(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  ret.id = String(ret._id)
  delete ret._id
  delete ret.__v
  return ret
}

const SubtaskSchema = new Schema<SubtaskAttrs>(
  {
    text: { type: String, required: true, trim: true, maxlength: MAX_SUBTASK_TEXT },
    done: { type: Boolean, default: false },
  },
  {
    _id: true,
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { transform: toIdJSON },
  },
)

const ReminderSchema = new Schema<ReminderEntry>(
  {
    at: { type: Date, required: true },
    firedAt: { type: Date },
    kind: { type: String, enum: REMINDER_KINDS, default: 'due' },
  },
  { _id: false },
)

const TaskSchema = new Schema<TaskAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    domain: { type: String, enum: DOMAINS, required: true, index: true },
    // Defaults to 'list' so legacy rows + manual creates without an explicit
    // kind stay passive (never silently start firing). The chat agent sets
    // 'reminder' deliberately, and only ever with a dueAt.
    kind: { type: String, enum: TASK_KINDS, default: 'list', index: true },
    status: { type: String, enum: TASK_STATUSES, default: 'open', index: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal', index: true },
    subtasks: {
      type: [SubtaskSchema],
      default: [],
      validate: {
        validator: (v: SubtaskAttrs[]) => v.length <= MAX_SUBTASKS,
        message: `subtasks cannot exceed ${MAX_SUBTASKS} items`,
      },
    },
    tags: {
      type: [{ type: String, maxlength: MAX_TAG_LENGTH }],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_TAGS,
        message: `tags cannot exceed ${MAX_TAGS} entries`,
      },
    },
    dueAt: { type: Date },
    notes: { type: String, maxlength: 2000 },
    sourceVoiceNoteId: { type: Schema.Types.ObjectId, ref: 'VoiceNote' },
    sourceDocumentId: { type: Schema.Types.ObjectId },
    sourceTaskKey: { type: String },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS },
    completedAt: { type: Date },
    snoozedUntil: { type: Date },
    reminders: { type: [ReminderSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: {
      transform: toIdJSON,
    },
  },
)

// The reminder invariant: a matter that exists to fire MUST have a moment to
// fire at. Runs on create()/save(); the chat tool layer (createTaskArgs) also
// enforces it so the model gets a clean, correctable error before persistence.
TaskSchema.pre('validate', function enforceReminderHasDue(next) {
  if (this.kind === 'reminder' && !this.dueAt) {
    this.invalidate('dueAt', 'A reminder must have a dueAt.')
  }
  next()
})

// Today screen pulls open tasks ordered by dueAt; Briefing filters by date range.
TaskSchema.index({ userId: 1, status: 1, dueAt: 1 })
TaskSchema.index({ userId: 1, domain: 1, createdAt: -1 })
TaskSchema.index({ userId: 1, status: 1, priority: 1 })
TaskSchema.index({ userId: 1, tags: 1 })
// Reminder worker claim: scan open tasks with an un-fired reminder due now.
TaskSchema.index({ status: 1, 'reminders.firedAt': 1, 'reminders.at': 1 })
// Idempotency for voice-extracted tasks: a given (note, item key) maps to at
// most one Task. Partial so it only applies to voice-sourced rows — manual /
// chat tasks have no sourceTaskKey and are unaffected.
TaskSchema.index(
  { userId: 1, sourceVoiceNoteId: 1, sourceTaskKey: 1 },
  { unique: true, partialFilterExpression: { sourceTaskKey: { $type: 'string' } } },
)

export type TaskDoc = HydratedDocument<TaskAttrs>
type TaskModel = Model<TaskAttrs>

export const Task: TaskModel =
  (mongoose.models.Task as TaskModel | undefined) ??
  mongoose.model<TaskAttrs>('Task', TaskSchema)
