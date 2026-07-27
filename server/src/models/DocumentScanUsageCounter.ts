import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'

// One row per (userId, month). Monthly bucket (not daily like AiUsageCounter)
// because document scans are a sustained-cost guard, not a burst guard — the
// per-user rate limiter already covers bursts.

export interface DocumentScanUsageCounterAttrs {
  userId: Types.ObjectId
  month: string // YYYY-MM UTC
  count: number
}

const DocumentScanUsageCounterSchema = new Schema<DocumentScanUsageCounterAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    month: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
)

DocumentScanUsageCounterSchema.index({ userId: 1, month: 1 }, { unique: true })

export type DocumentScanUsageCounterDoc = HydratedDocument<DocumentScanUsageCounterAttrs>
type DocumentScanUsageCounterModel = Model<DocumentScanUsageCounterAttrs>

export const DocumentScanUsageCounter: DocumentScanUsageCounterModel =
  (mongoose.models.DocumentScanUsageCounter as DocumentScanUsageCounterModel | undefined) ??
  mongoose.model<DocumentScanUsageCounterAttrs>(
    'DocumentScanUsageCounter',
    DocumentScanUsageCounterSchema,
  )

export function utcMonthBucket(date: Date = new Date()): string {
  return date.toISOString().slice(0, 7)
}
