import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// The dashboard's daily digest, cached.
//
// One row per (userId, localDate). The dashboard loads this on EVERY visit, so
// regenerating it per request — which means a Gemini call per request — is not
// an option. The row holds the whole rendered payload plus a `sourceHash` of
// the user's matter state; a request whose hash still matches is served from
// here without touching the model.
//
// The payload is stored in full rather than recomputed from parts because the
// prose half (headline, theme labels) cannot be recomputed cheaply — that is
// the entire reason this collection exists.

export interface DailyDigestCounts {
  dueToday: number
  completedToday: number
  openTotal: number
  slipping: number
  /** Open clarifications awaiting an answer. */
  needsInput: number
  /** ScannedDocument rows sitting in `ready_for_review`. */
  scansAwaitingReview: number
}

export interface DailyDigestTheme {
  label: string
  count: number
  taskIds: string[]
}

export interface DailyDigestDuplicate {
  title: string
  count: number
  taskIds: string[]
}

// The response body of GET /me/digest. Mirrors the client type in
// queries/digest.ts — if you change one, change both.
export interface DailyDigestPayload {
  /** Local calendar date this digest describes, 'YYYY-MM-DD'. */
  localDate: string
  generatedAt: string
  /** One sentence. The ONLY free prose the model writes. */
  headline: string
  counts: DailyDigestCounts
  /** Summed from today's task estimates. Zeros when nothing is estimated. */
  estimatedMinutesToday: { min: number; max: number }
  themes: DailyDigestTheme[]
  busiestDay: { date: string; count: number } | null
  duplicates: DailyDigestDuplicate[]
}

export interface DailyDigestAttrs {
  userId: Types.ObjectId
  localDate: string
  /** Fingerprint of the matter state the payload was computed from. */
  sourceHash: string
  /**
   * The language the prose in `payload` is written in. Part of the row rather
   * than only the hash because the themes are deliberately carried forward
   * between builds — and a carried Arabic label under a freshly English headline
   * is the one stale state that looks like a bug rather than like wording.
   */
  locale?: string
  generatedAt: Date
  payload: DailyDigestPayload
}

// Every sub-schema is `_id: false`: the payload is written and read whole,
// never addressed piecewise, so per-element ids would be dead weight that also
// leak into the response (a parent toJSON transform does not recurse into
// subdocuments — see the note in models/Task.ts).
const CountsSchema = new Schema<DailyDigestCounts>(
  {
    dueToday: { type: Number, required: true, default: 0 },
    completedToday: { type: Number, required: true, default: 0 },
    openTotal: { type: Number, required: true, default: 0 },
    slipping: { type: Number, required: true, default: 0 },
    needsInput: { type: Number, required: true, default: 0 },
    scansAwaitingReview: { type: Number, required: true, default: 0 },
  },
  { _id: false },
)

const ThemeSchema = new Schema<DailyDigestTheme>(
  {
    label: { type: String, required: true },
    count: { type: Number, required: true },
    taskIds: { type: [String], default: [] },
  },
  { _id: false },
)

const DuplicateSchema = new Schema<DailyDigestDuplicate>(
  {
    title: { type: String, required: true },
    count: { type: Number, required: true },
    taskIds: { type: [String], default: [] },
  },
  { _id: false },
)

const PayloadSchema = new Schema<DailyDigestPayload>(
  {
    localDate: { type: String, required: true },
    generatedAt: { type: String, required: true },
    headline: { type: String, required: true },
    counts: { type: CountsSchema, required: true },
    estimatedMinutesToday: {
      type: new Schema<{ min: number; max: number }>(
        { min: { type: Number, default: 0 }, max: { type: Number, default: 0 } },
        { _id: false },
      ),
      required: true,
    },
    themes: { type: [ThemeSchema], default: [] },
    busiestDay: {
      type: new Schema<{ date: string; count: number }>(
        { date: { type: String, required: true }, count: { type: Number, required: true } },
        { _id: false },
      ),
      default: null,
    },
    duplicates: { type: [DuplicateSchema], default: [] },
  },
  { _id: false },
)

const DailyDigestSchema = new Schema<DailyDigestAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    localDate: { type: String, required: true },
    sourceHash: { type: String, required: true },
    locale: { type: String },
    // TTL: a digest is worthless the day after it describes. Expiring the rows
    // keeps this collection bounded to roughly one row per active user without
    // anyone having to remember to sweep it.
    generatedAt: { type: Date, required: true, expires: 60 * 60 * 24 * 7 },
    payload: { type: PayloadSchema, required: true },
  },
  { timestamps: true },
)

// The lookup, and the uniqueness guarantee behind the upsert: one digest per
// user per local day. Unique so two concurrent dashboard loads cannot both
// insert — the loser gets a duplicate-key error it can safely ignore.
DailyDigestSchema.index({ userId: 1, localDate: 1 }, { unique: true })

export type DailyDigestDoc = HydratedDocument<DailyDigestAttrs>
type DailyDigestModel = Model<DailyDigestAttrs>

export const DailyDigest: DailyDigestModel =
  (mongoose.models.DailyDigest as DailyDigestModel | undefined) ??
  mongoose.model<DailyDigestAttrs>('DailyDigest', DailyDigestSchema)
