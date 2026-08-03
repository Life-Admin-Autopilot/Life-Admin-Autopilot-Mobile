import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// One row per (userId, month, LOCALE). Three axes, where the other two counters
// have two: AiUsageCounter is daily+kind, DocumentScanUsageCounter is monthly
// with no discriminator. Translating a backlog is allowed once per month PER
// TARGET LANGUAGE — a user who switches to Arabic and later to a third language
// should not find the allowance already spent by the first switch.
//
// The limit is 1, so `count: { $lt: 1 }` in the admission filter makes claiming
// the month a pure atomic once-per-bucket operation with no new concurrency
// reasoning beyond what documentScanQuota already does.

export interface TranslationUsageCounterAttrs {
  userId: Types.ObjectId
  month: string // YYYY-MM UTC
  locale: string // the language translated INTO
  count: number
}

const TranslationUsageCounterSchema = new Schema<TranslationUsageCounterAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    month: { type: String, required: true },
    locale: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

TranslationUsageCounterSchema.index({ userId: 1, month: 1, locale: 1 }, { unique: true })

export type TranslationUsageCounterDoc = HydratedDocument<TranslationUsageCounterAttrs>
type TranslationUsageCounterModel = Model<TranslationUsageCounterAttrs>

export const TranslationUsageCounter: TranslationUsageCounterModel =
  (mongoose.models.TranslationUsageCounter as TranslationUsageCounterModel | undefined) ??
  mongoose.model<TranslationUsageCounterAttrs>(
    'TranslationUsageCounter',
    TranslationUsageCounterSchema,
  )
