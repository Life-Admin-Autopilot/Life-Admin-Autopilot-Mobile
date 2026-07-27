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

// Expo push token registered per device. Used by the voice pipeline to notify
// when a recording finished processing. Capped + deduped by token on write.
export interface DeviceToken {
  token: string
  platform: DevicePlatform
  registeredAt: Date
}

export const MAX_DEVICE_TOKENS = 10

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
  passwordHash?: string
  displayName?: string
  preferredDomains: Domain[]
  hasOnboarded: boolean
  onboardingAnswers: OnboardingAnswer[]
  emailVerifiedAt?: Date
  theme: Theme
  textSize: TextSize
  mic: MicPrefs
  notifications: NotificationPrefs
  privacy: PrivacyPrefs
  subscription: SubscriptionState
  deviceTokens: DeviceToken[]
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

const DeviceTokenSchema = new Schema<DeviceToken>(
  {
    token: { type: String, required: true },
    platform: { type: String, enum: DEVICE_PLATFORMS, required: true },
    registeredAt: { type: Date, default: () => new Date() },
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
    theme: { type: String, enum: THEMES, default: 'system' },
    textSize: { type: String, enum: TEXT_SIZES, default: 'md' },
    mic: { type: MicSchema, default: () => ({}) },
    notifications: { type: NotificationSchema, default: () => ({}) },
    privacy: { type: PrivacySchema, default: () => ({}) },
    subscription: { type: SubscriptionSchema, default: () => ({}) },
    deviceTokens: { type: [DeviceTokenSchema], default: [] },
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
    delete obj.passwordHash
    return obj
  },
})

export type UserDoc = HydratedDocument<UserAttrs>

export const User: Model<UserAttrs> =
  mongoose.models.User ?? mongoose.model<UserAttrs>('User', UserSchema)
