import mongoose, { Schema, type Model, type Types } from 'mongoose'

export const TOKEN_PURPOSES = [
  'email_verification',
  'password_reset',
  'magic_link',
  // Short numeric codes typed into the app rather than links tapped in a mail
  // client. The native shell registers no URL scheme yet (docs/CAPACITOR.md),
  // so a mailed link cannot return to the app — a code can.
  'email_verification_code',
  'email_change',
] as const
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
