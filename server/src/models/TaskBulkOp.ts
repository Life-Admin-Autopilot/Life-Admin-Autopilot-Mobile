import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { CONFIDENCE_BUCKETS, type ConfidenceBucket } from './Task'

// One record per multi-task mutation — the unit of undo.
//
// Everything that touches more than one task at a time writes exactly one of
// these: bulk complete/snooze/delete from the selection bar, a date-range
// delete, and an AI categorization run. That gives every such operation a
// single reversible handle instead of N independent edits the user would have
// to unpick by hand.
//
// `kind` splits the two lifecycles:
//   bulk       — created already `applied`; the user can `undone` it.
//   categorize — created `proposed` (nothing written to Task yet), then either
//                `applied` after diff review or `discarded`. Once applied it
//                can be `undone` like any other op.

export const BULK_OP_KINDS = ['bulk', 'categorize'] as const
export type BulkOpKind = (typeof BULK_OP_KINDS)[number]

export const BULK_OP_STATUSES = ['proposed', 'applied', 'undone', 'discarded'] as const
export type BulkOpStatus = (typeof BULK_OP_STATUSES)[number]

export const BULK_ACTIONS = [
  'delete',
  'complete',
  'snooze',
  'setDomain',
  'addTags',
  'categorize',
] as const
export type BulkAction = (typeof BULK_ACTIONS)[number]

// How long an op stays undoable. The toast is a 5-second affordance; Trash and
// this record are the real safety net, and they must outlive the session.
export const BULK_OP_TTL_DAYS = 30

// Per-task before/after. Both are sparse patches holding ONLY the fields this
// op touched.
//
// Convention that makes undo exact: inside `prior`, an explicit `null` means
// "this field did not exist before" and must be `$unset` on undo — as opposed
// to a missing key, which means "not touched". Without that distinction, undoing
// a snooze on a task that never had a `snoozedUntil` would leave the field
// behind at its post-op value.
export interface BulkOpEntry {
  taskId: Types.ObjectId
  prior: Record<string, unknown>
  next: Record<string, unknown>
  // Populated for `categorize` entries only — drives which rows are pre-checked
  // in the diff review and the one-line provenance shown on the task afterwards.
  confidence?: ConfidenceBucket
  reason?: string
}

export interface TaskBulkOpAttrs {
  userId: Types.ObjectId
  kind: BulkOpKind
  action: BulkAction
  status: BulkOpStatus
  entries: BulkOpEntry[]
  // The natural-language range or query that produced this op, kept for the
  // confirm card and the run history ("Deleted 42 matters · Jan 1 – Mar 31").
  label?: string
  appliedAt?: Date
  undoneAt?: Date
  expiresAt: Date
}

const EntrySchema = new Schema<BulkOpEntry>(
  {
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true },
    prior: { type: Schema.Types.Mixed, default: {} },
    next: { type: Schema.Types.Mixed, default: {} },
    confidence: { type: String, enum: CONFIDENCE_BUCKETS },
    reason: { type: String, maxlength: 240 },
  },
  { _id: false },
)

const TaskBulkOpSchema = new Schema<TaskBulkOpAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: BULK_OP_KINDS, required: true },
    action: { type: String, enum: BULK_ACTIONS, required: true },
    status: { type: String, enum: BULK_OP_STATUSES, required: true },
    entries: { type: [EntrySchema], default: [] },
    label: { type: String, maxlength: 240 },
    appliedAt: { type: Date },
    undoneAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        return ret
      },
    },
  },
)

// Run history + "is there anything to undo" lookups.
TaskBulkOpSchema.index({ userId: 1, createdAt: -1 })
// A user should never have two categorize runs open at once — the second would
// propose against state the first is about to change.
TaskBulkOpSchema.index(
  { userId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { status: 'proposed' } },
)
// Mongo reaps the document once expiresAt passes.
TaskBulkOpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export function bulkOpExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + BULK_OP_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export type TaskBulkOpDoc = HydratedDocument<TaskBulkOpAttrs>
type TaskBulkOpModel = Model<TaskBulkOpAttrs>

export const TaskBulkOp: TaskBulkOpModel =
  (mongoose.models.TaskBulkOp as TaskBulkOpModel | undefined) ??
  mongoose.model<TaskBulkOpAttrs>('TaskBulkOp', TaskBulkOpSchema)
