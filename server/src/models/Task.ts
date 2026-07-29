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

// Connected services a matter can arrive from. Kept as a closed set rather than
// a free string so an importer cannot invent a provider name that the idempotency
// index and the citation chip then disagree about.
export const EXTERNAL_SOURCES = [
  'google_calendar',
  'google_tasks',
  'apple_calendar',
  'apple_reminders',
  'ics_feed',
  'email_forward',
] as const
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number]

// Declared here rather than imported from modules/integrations/dateOnly to keep
// the dependency pointing one way (dateOnly -> models, never models -> modules).
export const TIME_PRECISIONS = ['exact', 'dateOnly', 'floating'] as const
export type TimePrecision = (typeof TIME_PRECISIONS)[number]

// How long a matter takes to DO, as a bucketed range. Buckets, not integers,
// are the whole point: a model that answers "23 minutes" is claiming a
// precision it does not have, and the user reads that precision as a promise.
// The ladder makes the honest claim — "about a quarter of an hour" — the only
// claim anything can make. Every value that reaches the database is snapped
// onto it by normalizeEstimate().
export const ESTIMATE_BUCKETS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240] as const
export type EstimateBucket = (typeof ESTIMATE_BUCKETS)[number]

// Gemini can only constrain a field to a fixed set when that field is a STRING,
// so every AI response schema asks for the bucket as a label and parses it back.
export const ESTIMATE_BUCKET_LABELS: string[] = ESTIMATE_BUCKETS.map(String)

// 'user' is authoritative forever — no AI pass may overwrite it. That rule is
// enforced at each write site rather than here, because the model layer never
// sees who is asking.
export const ESTIMATE_SOURCES = ['ai', 'user'] as const
export type EstimateSource = (typeof ESTIMATE_SOURCES)[number]

export interface TaskEstimate {
  /** Lower bound, minutes. Always one of ESTIMATE_BUCKETS. */
  minMinutes: number
  /** Upper bound, minutes. Always one of ESTIMATE_BUCKETS, >= minMinutes. */
  maxMinutes: number
  source: EstimateSource
}

// Snap an arbitrary minute count onto the ladder. Ties round UP: people
// underestimate how long admin takes, so the generous side is the safer error.
export function snapToEstimateBucket(minutes: number): EstimateBucket {
  const [smallest] = ESTIMATE_BUCKETS
  // The floor is handled up front rather than left to the distance comparison:
  // NaN compares false against everything and -Infinity is equidistant from
  // every bucket, so both would otherwise fall through to a nonsense winner.
  if (Number.isNaN(minutes) || minutes <= smallest) return smallest
  // Nearest bucket wins, which clamps the top for free — anything above the
  // ladder is nearest to its ceiling. `<=` lets the larger bucket win a tie.
  return ESTIMATE_BUCKETS.reduce<EstimateBucket>(
    (best, bucket) => (Math.abs(bucket - minutes) <= Math.abs(best - minutes) ? bucket : best),
    smallest,
  )
}

// Coerce whatever a model (or a client) sent into a real number. Strings are
// accepted because the AI response schemas constrain buckets as string labels.
function toMinutes(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.trim())
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// The single hardening gate for every estimate that enters the system, from any
// source. A model that answered 23, or answered max < min, or answered only one
// bound, is CORRECTED rather than rejected — dropping the estimate over a
// fixable mistake loses information the user would have found useful.
export function normalizeEstimate(
  input: { minMinutes?: unknown; maxMinutes?: unknown } | null | undefined,
  source: EstimateSource,
): TaskEstimate | undefined {
  if (!input) return undefined
  // One bound alone is still an estimate — a point estimate. No bound is not.
  // Sorting the surviving bounds is what enforces maxMinutes >= minMinutes: a
  // model that swapped them gets a usable range, not a rejection.
  const bounds = [toMinutes(input.minMinutes), toMinutes(input.maxMinutes)].filter(
    (v): v is number => v !== null,
  )
  if (bounds.length === 0) return undefined

  return {
    minMinutes: snapToEstimateBucket(Math.min(...bounds)),
    maxMinutes: snapToEstimateBucket(Math.max(...bounds)),
    source,
  }
}

// Numeric weights used for sort order — higher = earlier in the list.
// Surfaced via toJSON's `priorityRank` field so the client can sort/compare
// without duplicating this table.
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
  // Provenance for a matter imported from a connected service. `externalSource`
  // names the provider; `externalId` is that provider's own stable id. Together
  // with userId they give the same idempotency guarantee the voice and document
  // pipelines already have — a re-run of a poll can never double-create.
  externalSource?: ExternalSource
  externalId?: string
  // How precisely the EXTERNAL source specified the time, when this matter came
  // from one. 'dateOnly' means the source gave a date and dueAt's time-of-day is
  // the user's own stated default; 'floating' means the source gave a wall clock
  // with no timezone and we assumed the user's. Both must be visible in the
  // citation — a rendered time that looks source-derived but isn't is precisely
  // the trust failure principles.md is built around. See
  // modules/integrations/dateOnly.ts.
  timePrecision?: TimePrecision
  confidence?: ConfidenceBucket
  // How long this is expected to take. Optional everywhere and absent on every
  // task created before the feature existed — every consumer must render
  // without it.
  estimate?: TaskEstimate
  completedAt?: Date
  snoozedUntil?: Date
  // Scheduled reminder moments (smart lead-time + at-due). Regenerated whenever
  // a reminder task's dueAt/kind changes; the reminder worker fires un-fired ones.
  reminders: ReminderEntry[]
  // Soft delete. Set instead of removing the document so every delete — manual,
  // bulk, or agent-issued — stays reversible from Trash. ALL reads must filter
  // `deletedAt: { $exists: false }`; use `notDeleted()` below rather than
  // hand-writing it, so no query path silently resurrects trashed rows.
  deletedAt?: Date
  // How many times this task's dueAt has been pushed back. Drives "what's
  // slipping" detection and the reminder-fatigue signal.
  rescheduleCount: number
}

// The soft-delete predicate, in one place. Spread into every Task read filter.
export function notDeleted(): Record<string, unknown> {
  return { deletedAt: { $exists: false } }
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

// Task's own transform — id mapping plus the derived `priorityRank` the client
// sorts and compares on, so PRIORITY_RANK never has to be duplicated there.
function toTaskJSON(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  toIdJSON(_doc, ret)
  ret.priorityRank = PRIORITY_RANK[ret.priority as TaskPriority] ?? PRIORITY_RANK.normal
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

// Exported so the staging records that hold a candidate task before it becomes
// one — VoiceNote's extracted/review items, ScannedDocument's candidates —
// store the estimate under exactly the same constraints the Task will.
export const EstimateSchema = new Schema<TaskEstimate>(
  {
    minMinutes: { type: Number, required: true, enum: ESTIMATE_BUCKETS },
    maxMinutes: { type: Number, required: true, enum: ESTIMATE_BUCKETS },
    source: { type: String, enum: ESTIMATE_SOURCES, required: true },
  },
  { _id: false },
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
    externalSource: { type: String, enum: EXTERNAL_SOURCES },
    externalId: { type: String },
    timePrecision: { type: String, enum: TIME_PRECISIONS },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS },
    estimate: { type: EstimateSchema },
    completedAt: { type: Date },
    snoozedUntil: { type: Date },
    reminders: { type: [ReminderSchema], default: [] },
    deletedAt: { type: Date },
    rescheduleCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: toTaskJSON,
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

// Backstop for the range invariant on create()/save(). It is only a backstop:
// findOneAndUpdate/bulkWrite skip document hooks, so the real guarantee comes
// from normalizeEstimate() at every write site.
TaskSchema.pre('validate', function enforceEstimateOrder(next) {
  const estimate = this.estimate
  if (estimate && estimate.maxMinutes < estimate.minMinutes) {
    this.invalidate('estimate.maxMinutes', 'maxMinutes must be >= minMinutes.')
  }
  next()
})

// Today screen pulls open tasks ordered by dueAt; Briefing filters by date range.
TaskSchema.index({ userId: 1, status: 1, dueAt: 1 })
// The Matters list: every read is scoped by user + live-ness first, then narrowed
// by status and ordered by dueAt. Leads with the two fields present in EVERY
// query so it stays usable no matter which optional filters the user applies.
TaskSchema.index({ userId: 1, deletedAt: 1, status: 1, dueAt: 1 })
// Trash view — newest-deleted first.
TaskSchema.index({ userId: 1, deletedAt: -1 })
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
  {
    unique: true,
    partialFilterExpression: {
      sourceTaskKey: { $type: 'string' },
      sourceVoiceNoteId: { $type: 'objectId' },
    },
  },
)
// Same idempotency guarantee for document-scan-sourced tasks.
TaskSchema.index(
  { userId: 1, sourceDocumentId: 1, sourceTaskKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      sourceTaskKey: { $type: 'string' },
      sourceDocumentId: { $type: 'objectId' },
    },
  },
)
// And for matters imported from a connected service. This is what makes a poll
// safe to re-run: Google Tasks has no webhooks, so the importer re-reads an
// overlapping window on every tick, and without this a slow tick would fan a
// single reminder out into duplicates. Partial so only imported rows are
// constrained — manual, voice and document matters carry no externalId.
TaskSchema.index(
  { userId: 1, externalSource: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      externalSource: { $type: 'string' },
      externalId: { $type: 'string' },
    },
  },
)

export type TaskDoc = HydratedDocument<TaskAttrs>
type TaskModel = Model<TaskAttrs>

export const Task: TaskModel =
  (mongoose.models.Task as TaskModel | undefined) ??
  mongoose.model<TaskAttrs>('Task', TaskSchema)
