import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

import { DOMAINS, type Domain } from './User'
import { TASK_PRIORITIES, type TaskPriority } from './Task'

// A clarification is ONE held item the chat agent couldn't resolve on its own
// (ambiguous date, unnameable task, in-message duplicate). Instead of burying
// the question in chat prose, Mo emits a `holdForClarification` tool call that
// persists one of these. The home banner surfaces open ones; the /clarify
// card-stack resolves them into real Tasks. Mirrors the voice-review precedent
// (held item → user answers → Task created), but born from a chat turn rather
// than a background worker.

export const CLARIFICATION_STATUSES = ['open', 'resolved', 'dropped'] as const
export type ClarificationStatus = (typeof CLARIFICATION_STATUSES)[number]

// What kind of question this is — drives how the card renders the answers.
//   date   — the user floated two/unsure dates; options each carry a resolved
//            dueAt so picking creates the task instantly.
//   detail — too vague to title (the "email that guy" case); usually free-text
//            only, options may be empty.
//   choice — a discrete pick that patches the draft (title/notes/dueAt).
export const CLARIFICATION_KINDS = ['date', 'detail', 'choice'] as const
export type ClarificationKind = (typeof CLARIFICATION_KINDS)[number]

// A pre-resolved suggested answer. `label` is what the chip shows; the patch
// fields (dueAt/title/notes) are merged onto the draft when the user picks it,
// so the common case creates the Task deterministically — no second AI round.
export interface ClarificationOption {
  label: string
  dueAt?: Date
  title?: string
  notes?: string
}

// The provisional task Mo would create once the question is answered.
export interface ClarificationDraft {
  title: string
  domain: Domain
  priority: TaskPriority
  notes?: string
  tags: string[]
  dueAt?: Date
}

export interface ClarificationAttrs {
  userId: Types.ObjectId
  status: ClarificationStatus
  draft: ClarificationDraft
  question: string
  kind: ClarificationKind
  options: ClarificationOption[]
  // Idempotency key for VOICE-born holds: the note-scoped item key. Lets a
  // worker reclaim/retry upsert the same held item instead of duplicating it.
  // Omitted for chat-born holds (each is a fresh create).
  sourceKey?: string
  // Resolution audit — what the user picked/typed and the Task it produced.
  answer?: string
  createdTaskId?: Types.ObjectId
  resolvedAt?: Date
}

// _id:false on the embedded schemas: options/draft are referenced by array
// index (and merged wholesale), never individually addressed — so they don't
// need ids. This also sidesteps the subdoc-toJSON-id pitfall (a parent
// transform doesn't recurse, so a subdoc with _id would serialize _id but no
// id). No _id → nothing to strip.
const ClarificationOptionSchema = new Schema<ClarificationOption>(
  {
    label: { type: String, required: true },
    dueAt: { type: Date },
    title: { type: String },
    notes: { type: String },
  },
  { _id: false },
)

const ClarificationDraftSchema = new Schema<ClarificationDraft>(
  {
    title: { type: String, required: true },
    domain: { type: String, enum: DOMAINS, required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'normal' },
    notes: { type: String },
    tags: { type: [String], default: [] },
    dueAt: { type: Date },
  },
  { _id: false },
)

const ClarificationSchema = new Schema<ClarificationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: CLARIFICATION_STATUSES, default: 'open', index: true },
    draft: { type: ClarificationDraftSchema, required: true },
    question: { type: String, required: true },
    kind: { type: String, enum: CLARIFICATION_KINDS, default: 'date' },
    options: { type: [ClarificationOptionSchema], default: [] },
    sourceKey: { type: String },
    answer: { type: String },
    createdTaskId: { type: Schema.Types.ObjectId, ref: 'Task' },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret: Record<string, unknown>) => {
        ret.id = String(ret._id)
        delete ret._id
        delete ret.__v
        // Internal idempotency key — never sent to the client.
        delete ret.sourceKey
        return ret
      },
    },
  },
)

// Drives the home banner / card-stack query: "my open clarifications, newest first".
ClarificationSchema.index({ userId: 1, status: 1, createdAt: -1 })
// Idempotency for voice-born holds: at most one Clarification per (user,
// sourceKey). Partial so the many chat-born holds (no sourceKey) don't collide.
ClarificationSchema.index(
  { userId: 1, sourceKey: 1 },
  { unique: true, partialFilterExpression: { sourceKey: { $type: 'string' } } },
)

export type ClarificationDoc = HydratedDocument<ClarificationAttrs>
type ClarificationModel = Model<ClarificationAttrs>

export const Clarification: ClarificationModel =
  (mongoose.models.Clarification as ClarificationModel | undefined) ??
  mongoose.model<ClarificationAttrs>('Clarification', ClarificationSchema)
