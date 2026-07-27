import mongoose, { Schema, type Model, type Types } from 'mongoose'

export const TOKEN_PURPOSES = ['email_verification', 'password_reset', 'magic_link'] as const
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number]

export interface VerificationTokenAttrs {
  userId: Types.ObjectId
  tokenHash: string
  purpose: TokenPurpose
  expiresAt: Date
  consumedAt?: Date
}

const VerificationTokenSchema = new Schema<VerificationTokenAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    purpose: { type: String, enum: TOKEN_PURPOSES, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date },
  },
  { timestamps: true },
)

VerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export const VerificationToken: Model<VerificationTokenAttrs> =
  mongoose.models.VerificationToken ??
  mongoose.model<VerificationTokenAttrs>('VerificationToken', VerificationTokenSchema)
