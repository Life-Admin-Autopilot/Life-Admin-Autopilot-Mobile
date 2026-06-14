import mongoose, { Schema, type Model, type Types } from 'mongoose'

export interface RefreshTokenAttrs {
  userId: Types.ObjectId
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
  replacedBy?: string
  userAgent?: string
  ip?: string
  lastUsedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

const RefreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    replacedBy: { type: String },
    userAgent: { type: String },
    ip: { type: String },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
)

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const RefreshToken: Model<RefreshTokenAttrs> =
  mongoose.models.RefreshToken ??
  mongoose.model<RefreshTokenAttrs>('RefreshToken', RefreshTokenSchema)
