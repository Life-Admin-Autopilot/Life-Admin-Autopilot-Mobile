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
/**
 * How obligations imported from an external source behave.
 *
 * `defaultTimeOfDay` is load-bearing for the trust contract, not a cosmetic
 * setting. Google Tasks, Microsoft To Do and all-day EKReminders all hand us a
 * date with NO time, and Task.ts requires a reminder to carry a real dueAt. This
 * is the value we apply instead of letting a model invent one — which is what
 * lets the citation chip honestly say "your 09:00 default" rather than implying
 * the source specified a time it never had.
 *
 * See `modules/integrations/dateOnly.ts` for the full policy.
 */
export interface ImportPrefs {
  /** 'HH:mm' on a 24-hour clock, interpreted in the user's `timezone`. */
  defaultTimeOfDay: string
}

/**
 * Fallback when the user has never set one. Lives here rather than alongside the
 * resolver because Task already imports User — putting it the other way round
 * would let a future value-import turn `User -> dateOnly -> Task -> User` into a
 * real require cycle.
 */
export const DEFAULT_IMPORT_TIME = '09:00'
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
  /**
   * BCP 47 tag (e.g. `en-GB`). The EFFECTIVE language, not just the one the
   * user picked from a list — so it is set even when they asked to follow their
   * device. Everything that writes prose while no device is present reads this:
   * the daily digest, document extraction, voice-note extraction. A user whose
   * app is in Arabic and whose scans come back in English is the failure this
   * field exists to prevent, so it must never be null once anything has told us.
   */
  locale?: string
  /**
   * True when `locale` was read off a device rather than chosen. Kept apart
   * because the two behave differently across devices: a chosen language should
   * follow the account onto a new phone, a device-derived one must not — that
   * is how an Arabic phone's language would otherwise land on an English one.
   */
  localeFollowsDevice?: boolean
  theme: Theme
  textSize: TextSize
  mic: MicPrefs
  notifications: NotificationPrefs
  imports: ImportPrefs
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

const ImportSchema = new Schema<ImportPrefs>(
  {
    // Validated at the edge as well as here — parseTimeOfDay() falls back rather
    // than throwing, and a silent fallback to 00:00 would fire imported
    // reminders in the middle of the night.
    defaultTimeOfDay: {
      type: String,
      default: DEFAULT_IMPORT_TIME,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },
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
    localeFollowsDevice: { type: Boolean },
    theme: { type: String, enum: THEMES, default: 'system' },
    textSize: { type: String, enum: TEXT_SIZES, default: 'md' },
    mic: { type: MicSchema, default: () => ({}) },
    notifications: { type: NotificationSchema, default: () => ({}) },
    imports: { type: ImportSchema, default: () => ({}) },
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
