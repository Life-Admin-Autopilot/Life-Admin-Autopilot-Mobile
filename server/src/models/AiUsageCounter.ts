import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// One row per (userId, date, kind). Atomic $inc keeps the counter
// concurrent-safe. UTC date bucket so the rollover is deterministic
// regardless of caller tz.

export const AI_USAGE_KINDS = ['message'] as const
export type AiUsageKind = (typeof AI_USAGE_KINDS)[number]

export interface AiUsageCounterAttrs {
  userId: Types.ObjectId
  date: string // YYYY-MM-DD UTC
  kind: AiUsageKind
  count: number
}

const AiUsageCounterSchema = new Schema<AiUsageCounterAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: String, required: true },
    kind: { type: String, enum: AI_USAGE_KINDS, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

AiUsageCounterSchema.index({ userId: 1, date: 1, kind: 1 }, { unique: true })

export type AiUsageCounterDoc = HydratedDocument<AiUsageCounterAttrs>
type AiUsageCounterModel = Model<AiUsageCounterAttrs>

export const AiUsageCounter: AiUsageCounterModel =
  (mongoose.models.AiUsageCounter as AiUsageCounterModel | undefined) ??
  mongoose.model<AiUsageCounterAttrs>('AiUsageCounter', AiUsageCounterSchema)

export function utcDateBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10)
}
