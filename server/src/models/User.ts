import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose'

export const DOMAINS = ['health', 'home', 'car', 'finance', 'family', 'pets'] as const
export type Domain = (typeof DOMAINS)[number]

export const THEMES = ['system', 'light', 'dark'] as const
export type Theme = (typeof THEMES)[number]

export const TEXT_SIZES = ['sm', 'md', 'lg'] as const
export type TextSize = (typeof TEXT_SIZES)[number]

export const MIC_QUALITIES = ['standard', 'high'] as const
export type MicQuality = (typeof MIC_QUALITIES)[number]

export const SUBSCRIPTION_TIERS = ['free', 'pro'] as const
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number]

export interface MicPrefs {
  quality: MicQuality
}
export interface NotificationPrefs {
  push: boolean
  emailDigest: boolean
  marketing: boolean
}
export interface PrivacyPrefs {
  analytics: boolean
  crashReports: boolean
}
export interface SubscriptionState {
  tier: SubscriptionTier
  renewsAt?: Date
  canceledAt?: Date
}

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number]

// One captured onboarding Q&A. Persisted so the AI agent can read them later as
// personalization memory (which areas matter, tone preference, etc.).
export interface OnboardingAnswer {
  id: string
  question: string
  answer: string
}

export const MAX_ONBOARDING_ANSWERS = 20

export interface UserAttrs {
  email: string
  /**
   * An address the user has asked to move to but not yet confirmed. The account
   * still authenticates as `email` until the emailed code is accepted, so a
   * typo'd or hostile address can never lock anyone out.
   */
  pendingEmail?: string
  passwordHash?: string
  displayName?: string
  preferredDomains: Domain[]
  hasOnboarded: boolean
  onboardingAnswers: OnboardingAnswer[]
  emailVerifiedAt?: Date
  /**
   * IANA zone (e.g. `Africa/Cairo`). Optional on purpose: absent means "trust
   * whatever the device reports". It matters for the work that runs when no
   * device is present — the reminder worker and the daily digest both describe
   * a LOCAL calendar day, and without this they can only guess at UTC.
   */
  timezone?: string
  /** BCP 47 tag (e.g. `en-GB`). Display formatting only. */
  locale?: string
  theme: Theme
  textSize: TextSize
  mic: MicPrefs
  notifications: NotificationPrefs
  privacy: PrivacyPrefs
  subscription: SubscriptionState
}

// Sub-schemas use `_id: false` — these are embedded value objects, not
// addressable documents. All fields are defaulted so existing users hydrate
// with sensible settings without a migration.
const MicSchema = new Schema<MicPrefs>(
  { quality: { type: String, enum: MIC_QUALITIES, default: 'standard' } },
  { _id: false },
)

const NotificationSchema = new Schema<NotificationPrefs>(
  {
    push: { type: Boolean, default: true },
    emailDigest: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
  },
  { _id: false },
)

const PrivacySchema = new Schema<PrivacyPrefs>(
  {
    analytics: { type: Boolean, default: true },
    crashReports: { type: Boolean, default: true },
  },
  { _id: false },
)

const SubscriptionSchema = new Schema<SubscriptionState>(
  {
    tier: { type: String, enum: SUBSCRIPTION_TIERS, default: 'free' },
    renewsAt: { type: Date },
    canceledAt: { type: Date },
  },
  { _id: false },
)

const OnboardingAnswerSchema = new Schema<OnboardingAnswer>(
  {
    id: { type: String, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
  },
  { _id: false },
)

const UserSchema = new Schema<UserAttrs>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Deliberately NOT unique: two people may both have a pending move to the
    // same address, and only the one who confirms first gets it (the confirm
    // step re-checks `email` uniqueness). A unique index here would let anyone
    // block an address just by requesting it.
    pendingEmail: { type: String, lowercase: true, trim: true },
    passwordHash: { type: String },
    displayName: { type: String },
    preferredDomains: {
      type: [String],
      enum: DOMAINS,
      default: () => [...DOMAINS],
    },
    hasOnboarded: { type: Boolean, default: false },
    onboardingAnswers: { type: [OnboardingAnswerSchema], default: [] },
    emailVerifiedAt: { type: Date },
    timezone: { type: String },
    locale: { type: String },
    theme: { type: String, enum: THEMES, default: 'system' },
    textSize: { type: String, enum: TEXT_SIZES, default: 'md' },
    mic: { type: MicSchema, default: () => ({}) },
    notifications: { type: NotificationSchema, default: () => ({}) },
    privacy: { type: PrivacySchema, default: () => ({}) },
    subscription: { type: SubscriptionSchema, default: () => ({}) },
  },
  { timestamps: true },
)

UserSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    const obj = ret as unknown as Record<string, unknown>
    if (obj._id != null) obj.id = String(obj._id)
    delete obj._id
    // Whether a password EXISTS is not a secret, and the client genuinely needs
    // it: a magic-link account has none, so asking it to re-confirm one before
    // a destructive action would demand something the user cannot give. The
    // hash itself never leaves here.
    obj.hasPassword = typeof obj.passwordHash === 'string' && obj.passwordHash.length > 0
    delete obj.passwordHash
    return obj
  },
})

export type UserDoc = HydratedDocument<UserAttrs>

export const User: Model<UserAttrs> =
  mongoose.models.User ?? mongoose.model<UserAttrs>('User', UserSchema)
