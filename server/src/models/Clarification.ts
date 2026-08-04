import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

import { DOMAINS, type Domain } from './User'
import { TASK_PRIORITIES, type TaskPriority } from './Task'

// A clarification is ONE open question attached to a REAL Task — an ambiguous
// date, an unnameable item, an in-message duplicate. Kitto emits a
// `holdForClarification` tool call; the task is created immediately from the
// draft and the question rides alongside it.
//
// It did not always work this way. The task used to be withheld until the
// question was answered, so a captured thought lived only as `draft` on this
// row: absent from Matters, unsearchable, undeletable, and invisible except as
// a number on the dashboard. Deleting every task couldn't clear it because it
// had never BEEN a task. Microsoft's HAX G10 sanctions two responses to
// uncertainty — disambiguate, or degrade gracefully and act anyway — and
// withholding indefinitely is neither.
//
// The prompt (voice/toolRules.ts) already reasons about COST OF BEING WRONG.
// The model now honours it: the task always exists, and it's the REMINDER that
// is withheld on a high-cost guess, never the task itself.

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

// The provisional task Kitto would create once the question is answered.
export interface ClarificationDraft {
  title: string
  domain: Domain
  priority: TaskPriority
  notes?: string
  tags: string[]
  dueAt?: Date
}

// How much a wrong guess costs — the discriminator voice/toolRules.ts already
// applies in prose. 'low' (a nudge time that just gets rescheduled) lets the
// reminder fire on the guess. 'high' (a bill, a flight, a court date, a
// passport expiry) creates the task but withholds the reminder until the user
// confirms, so we never fire off a date we invented. Defaults to 'high': if the
// model felt the item was worth asking about, don't act on the guess.
export const CLARIFICATION_COSTS = ['low', 'high'] as const
export type ClarificationCost = (typeof CLARIFICATION_COSTS)[number]

export interface ClarificationAttrs {
  userId: Types.ObjectId
  // The Task this question is about. Created up front, BEFORE the answer —
  // required, so a held item can never again exist without something the user
  // can see and act on.
  taskId: Types.ObjectId
  status: ClarificationStatus
  draft: ClarificationDraft
  question: string
  kind: ClarificationKind
  costOfWrong: ClarificationCost
  options: ClarificationOption[]
  // What the user actually SAID — the chat message or voice transcript this
  // question came out of, verbatim. The card used to show only `draft.title`,
  // which is Kitto's paraphrase ("Email that guy"), so a question opened hours
  // later ("What's the email to that guy about?") asked the user to recall a
  // request they could no longer see. Their own words are the memory anchor.
  // Display-only: nothing reads it back into a prompt.
  sourceText?: string
  // Idempotency key for VOICE-born holds: the note-scoped item key. Lets a
  // worker reclaim/retry upsert the same held item instead of duplicating it.
  // Omitted for chat-born holds (each is a fresh create).
  sourceKey?: string
  // "Not now." Set by /defer when the user skips the card. Until this passes,
  // the item is filtered out of the list. Before it existed, Skip only bumped a
  // local index in the card stack — the row stayed indistinguishable from one
  // the user had never opened, so the same question greeted them next session.
  deferredUntil?: Date
  // Resolution audit — what the user picked/typed and the Task it produced.
  answer?: string
  resolvedAt?: Date
  // Supplied by `timestamps: true`; declared so cursor pagination can read them.
  createdAt?: Date
  updatedAt?: Date
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
    taskId: { type: Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    status: { type: String, enum: CLARIFICATION_STATUSES, default: 'open', index: true },
    draft: { type: ClarificationDraftSchema, required: true },
    question: { type: String, required: true },
    kind: { type: String, enum: CLARIFICATION_KINDS, default: 'date' },
    costOfWrong: { type: String, enum: CLARIFICATION_COSTS, default: 'high' },
    options: { type: [ClarificationOptionSchema], default: [] },
    sourceText: { type: String },
    sourceKey: { type: String },
    deferredUntil: { type: Date },
    answer: { type: String },
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

// The one definition of "a question the user should currently see": open, and
// not skipped into a cooling-off window. Every surface that counts or lists
// held items MUST compose this — the dashboard once derived its number from a
// 50-capped page while the digest aggregated the full collection, so the two
// disagreed for anyone with a real backlog.
export function visibleOpen(now: Date = new Date()): Record<string, unknown> {
  return {
    status: 'open',
    $or: [{ deferredUntil: { $exists: false } }, { deferredUntil: { $lte: now } }],
  }
}

export type ClarificationDoc = HydratedDocument<ClarificationAttrs>
type ClarificationModel = Model<ClarificationAttrs>

export const Clarification: ClarificationModel =
  (mongoose.models.Clarification as ClarificationModel | undefined) ??
  mongoose.model<ClarificationAttrs>('Clarification', ClarificationSchema)
