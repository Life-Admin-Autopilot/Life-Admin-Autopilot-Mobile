import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose'
import { DOMAINS, type Domain } from './User'

// A calendar feed the user subscribed to — school terms, bin collections, sports
// fixtures. Read-only and public: an ICS URL is a bearer capability, so we never
// treat it as a credential and never send one anywhere.
//
// Feeds are stored per user rather than deduplicated globally on purpose. Two
// parents at the same school hold the same URL, but they may file it under
// different domains and their timezones differ, and sharing a row would couple
// their sync failures together for no real saving.

export const ICS_FEED_STATUSES = ['active', 'error', 'gone'] as const
export type IcsFeedStatus = (typeof ICS_FEED_STATUSES)[number]

export interface IcsFeedAttrs {
  userId: Types.ObjectId
  /** Normalized absolute https URL — webcal: is rewritten before it lands here. */
  url: string
  /** What the user calls it. Shown wherever its events are cited. */
  label: string
  /** Which life domain this feed's events file into. */
  domain: Domain
  /**
   * Publisher cache validators from the last successful fetch, replayed on the
   * next poll. This is the whole reason polling an ICS feed is affordable: a
   * term-dates feed changes about three times a year, so nearly every poll ends
   * at a 304 with no body and no parsing.
   */
  etag?: string
  lastModified?: string
  lastFetchedAt?: Date
  /** Last fetch that actually returned a body we parsed. */
  lastSyncedAt?: Date
  status: IcsFeedStatus
  /**
   * Plain-language reason the last poll failed. Surfaced to the user, because a
   * feed that silently stops updating looks identical to a feed with nothing on
   * it — and the user would go on trusting reminders that stopped arriving.
   */
  lastError?: string
  /** Consecutive failures. Drives backoff so a dead URL is not hammered. */
  failureCount: number
  createdAt?: Date
  updatedAt?: Date
}

// Surface a string `id` and hide Mongo internals. Cache validators are stripped
// too — they are plumbing, mean nothing to a client, and only invite someone to
// try to "fix" a stuck sync by editing them.
function toIdJSON(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
  ret.id = String(ret._id)
  delete ret._id
  delete ret.__v
  delete ret.etag
  delete ret.lastModified
  return ret
}

const IcsFeedSchema = new Schema<IcsFeedAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    label: { type: String, required: true, trim: true, maxlength: 80 },
    domain: { type: String, enum: DOMAINS, required: true },
    etag: { type: String },
    lastModified: { type: String },
    lastFetchedAt: { type: Date },
    lastSyncedAt: { type: Date },
    status: { type: String, enum: ICS_FEED_STATUSES, default: 'active', index: true },
    lastError: { type: String },
    failureCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { transform: toIdJSON },
  },
)

// One subscription per (user, URL). Re-adding the same feed should update the
// existing row rather than fan the same events out twice under two feed ids.
IcsFeedSchema.index({ userId: 1, url: 1 }, { unique: true })

// Poller claim: oldest-fetched active feeds first.
IcsFeedSchema.index({ status: 1, lastFetchedAt: 1 })

export type IcsFeedDoc = HydratedDocument<IcsFeedAttrs>
type IcsFeedModel = Model<IcsFeedAttrs>

export const IcsFeed: IcsFeedModel =
  (mongoose.models.IcsFeed as IcsFeedModel) ??
  mongoose.model<IcsFeedAttrs>('IcsFeed', IcsFeedSchema)
