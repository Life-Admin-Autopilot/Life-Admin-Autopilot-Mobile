import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { DOMAINS, type Domain } from './User'

// A connected third-party account.
//
// One row per (user, provider). The refresh token is the only durable secret
// here and it is stored ENCRYPTED — see lib/tokenCipher.ts for why a plaintext
// column would be worse than a leaked password hash.
//
// Access tokens are stored too, but only as a cache: they expire in about an
// hour, and re-minting one on every poll would burn a network round trip per
// feed per tick for no reason. Losing them costs a refresh, nothing more.

export const INTEGRATION_PROVIDERS = ['google'] as const
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number]

export const INTEGRATION_STATUSES = ['active', 'needs_reauth', 'revoked'] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

export interface IntegrationAttrs {
  userId: Types.ObjectId
  provider: IntegrationProvider
  /** The provider's own account id (Google `sub`). Stable across email changes. */
  externalAccountId: string
  /** Shown so the user can tell which of their accounts is connected. */
  externalAccountEmail?: string
  /** Ciphertext from tokenCipher.encryptSecret. NEVER a raw token. */
  refreshTokenEnc: string
  /** Ciphertext. A cache — safe to drop, costs one refresh to rebuild. */
  accessTokenEnc?: string
  accessTokenExpiresAt?: Date
  /**
   * Scopes Google actually granted, which is not always what we asked for —
   * the consent screen lets a user tick some and not others. Every caller must
   * check this rather than assuming, or a user who declined Tasks gets a sync
   * that 403s on every tick with no explanation.
   */
  grantedScopes: string[]
  status: IntegrationStatus
  /**
   * Plain-language reason the connection stopped working. Surfaced to the user:
   * a silently dead integration looks exactly like one with nothing to sync,
   * and they would keep trusting reminders that stopped arriving.
   */
  lastError?: string
  /**
   * Google Calendar incremental-sync cursor.
   *
   * Google invalidates these on its own schedule and answers the next request
   * with 410 Gone, which is not an error condition but an instruction: wipe the
   * cursor and do a full sync. Anything treating 410 as a failure gets stuck
   * permanently, because the token never becomes valid again.
   */
  calendarSyncToken?: string
  calendarSyncedAt?: Date
  /** Google Tasks has no cursor — it is polled with updatedMin from here. */
  tasksSyncedAt?: Date
  /**
   * Which life domain imported items are filed under.
   *
   * Neither Google Tasks nor a bare calendar event carries a life-domain hint,
   * and classifying each one with a model would put a per-item AI call on the
   * margin business-model.md measures. So the user picks once and the existing
   * Categorize flow can re-file in bulk afterwards.
   */
  importDomain: Domain
  connectedAt: Date
  revokedAt?: Date
  createdAt?: Date
  updatedAt?: Date
}

// Strip every secret on the way out. Belt and braces: the routes also select
// explicit fields, but a future `res.json(integration)` must not be one edit
// away from leaking a refresh token.
function toIdJSON(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  ret.id = String(ret._id)
  delete ret._id
  delete ret.__v
  delete ret.refreshTokenEnc
  delete ret.accessTokenEnc
  delete ret.accessTokenExpiresAt
  return ret
}

const IntegrationSchema = new Schema<IntegrationAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: INTEGRATION_PROVIDERS, required: true },
    externalAccountId: { type: String, required: true },
    externalAccountEmail: { type: String },
    refreshTokenEnc: { type: String, required: true },
    accessTokenEnc: { type: String },
    accessTokenExpiresAt: { type: Date },
    grantedScopes: { type: [String], default: [] },
    status: { type: String, enum: INTEGRATION_STATUSES, default: 'active', index: true },
    lastError: { type: String },
    calendarSyncToken: { type: String },
    calendarSyncedAt: { type: Date },
    tasksSyncedAt: { type: Date },
    importDomain: { type: String, enum: DOMAINS, default: 'home' },
    connectedAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { transform: toIdJSON },
  },
)

// One connection per provider per user. Reconnecting updates the row in place —
// a second row would leave an orphaned refresh token that nothing ever revokes.
IntegrationSchema.index({ userId: 1, provider: 1 }, { unique: true })

export type IntegrationDoc = HydratedDocument<IntegrationAttrs>
type IntegrationModel = Model<IntegrationAttrs>

export const Integration: IntegrationModel =
  (mongoose.models.Integration as IntegrationModel) ??
  mongoose.model<IntegrationAttrs>('Integration', IntegrationSchema)
