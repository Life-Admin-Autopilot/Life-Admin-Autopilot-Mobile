import { env } from '../env'
import { VerificationToken, type TokenPurpose } from '../models/VerificationToken'
import type { UserDoc } from '../models/User'
import { sendEmail } from './email'
import { generateNumericCode, generateRawToken, hashCode, hashToken, ttlToMs } from './tokens'

const VERIFICATION_TTL = '24h'
const PASSWORD_RESET_TTL = '1h'
const MAGIC_LINK_TTL = '15m'
// Short enough that a stolen code is usually already dead, long enough to walk
// to another device and read the mail.
const CODE_TTL = '15m'

interface IssueTokenParams {
  user: UserDoc
  purpose: TokenPurpose
  ttl: string
}

async function issueVerificationToken({
  user,
  purpose,
  ttl,
}: IssueTokenParams): Promise<string> {
  const rawToken = generateRawToken()
  await VerificationToken.create({
    userId: user._id,
    tokenHash: hashToken(rawToken),
    purpose,
    expiresAt: new Date(Date.now() + ttlToMs(ttl)),
  })
  return rawToken
}

function deepLink(path: string, params: Record<string, string>): string {
  const scheme = env().APP_DEEP_LINK_SCHEME
  const query = new URLSearchParams(params).toString()
  return `${scheme}://${path}?${query}`
}

export async function sendVerificationEmail(user: UserDoc): Promise<void> {
  const token = await issueVerificationToken({
    user,
    purpose: 'email_verification',
    ttl: VERIFICATION_TTL,
  })
  const url = deepLink('auth/verify-email', { token })
  await sendEmail({
    to: user.email,
    subject: 'Verify your Life Admin email',
    text: `Hi — tap to verify your email: ${url}\n\nIf you didn't sign up, ignore this email.`,
    html: `
      <p>Hi,</p>
      <p>Tap to verify your email:</p>
      <p><a href="${url}">${url}</a></p>
      <p>If you didn't sign up, ignore this email.</p>
    `,
  })
}

export async function sendPasswordResetEmail(user: UserDoc): Promise<void> {
  const token = await issueVerificationToken({
    user,
    purpose: 'password_reset',
    ttl: PASSWORD_RESET_TTL,
  })
  const url = deepLink('auth/reset-password', { token })
  await sendEmail({
    to: user.email,
    subject: 'Reset your Life Admin password',
    text: `Tap to reset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
    html: `
      <p>Tap to reset your password:</p>
      <p><a href="${url}">${url}</a></p>
      <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    `,
  })
}

export async function sendMagicLinkEmail(user: UserDoc): Promise<void> {
  const token = await issueVerificationToken({
    user,
    purpose: 'magic_link',
    ttl: MAGIC_LINK_TTL,
  })
  const url = deepLink('auth/magic-callback', { token })
  await sendEmail({
    to: user.email,
    subject: 'Sign in to Life Admin',
    text: `Tap to sign in: ${url}\n\nThis link expires in 15 minutes.`,
    html: `
      <p>Tap to sign in:</p>
      <p><a href="${url}">${url}</a></p>
      <p>This link expires in 15 minutes.</p>
    `,
  })
}

// -- Numeric codes (typed into the app, not tapped in a mail client) ---------

async function issueCode(user: UserDoc, purpose: TokenPurpose): Promise<string> {
  // Only one live code per (user, purpose) — otherwise "resend" leaves the
  // previous code valid, and every resend widens the guessing window instead of
  // replacing it.
  await VerificationToken.deleteMany({ userId: user._id, purpose, consumedAt: { $exists: false } })
  const code = generateNumericCode()
  await VerificationToken.create({
    userId: user._id,
    tokenHash: hashCode(user.id, purpose, code),
    purpose,
    expiresAt: new Date(Date.now() + ttlToMs(CODE_TTL)),
  })
  return code
}

export async function sendEmailVerificationCode(user: UserDoc): Promise<void> {
  const code = await issueCode(user, 'email_verification_code')
  await sendEmail({
    to: user.email,
    subject: `${code} is your Kitto confirmation code`,
    text: `Your code is ${code}. It expires in 15 minutes.\n\nIf you didn't ask for this, ignore this email.`,
    html: `
      <p>Your code is:</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${code}</p>
      <p>It expires in 15 minutes.</p>
      <p>If you didn't ask for this, ignore this email.</p>
    `,
  })
}

/**
 * Goes to the NEW address, never the current one. The point of the code is to
 * prove the person asking for the move can actually receive mail there.
 */
export async function sendEmailChangeCode(user: UserDoc, newEmail: string): Promise<void> {
  const code = await issueCode(user, 'email_change')
  await sendEmail({
    to: newEmail,
    subject: `${code} is your Kitto confirmation code`,
    text: `Confirm this address for Kitto with the code ${code}. It expires in 15 minutes.\n\nIf you didn't ask for this, ignore this email.`,
    html: `
      <p>Confirm this address for Kitto:</p>
      <p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${code}</p>
      <p>It expires in 15 minutes.</p>
      <p>If you didn't ask for this, ignore this email.</p>
    `,
  })
}

/**
 * Redeem a numeric code. Scoped to the user, so a code minted for one account
 * is inert against another. Single-use: consumed on the first success.
 */
export async function consumeCode(
  userId: string,
  purpose: TokenPurpose,
  code: string,
): Promise<boolean> {
  const record = await VerificationToken.findOne({
    userId,
    purpose,
    tokenHash: hashCode(userId, purpose, code),
  })
  if (!record) return false
  if (record.consumedAt) return false
  if (record.expiresAt.getTime() <= Date.now()) return false

  record.consumedAt = new Date()
  await record.save()
  return true
}

export async function consumeVerificationToken(
  rawToken: string,
  purpose: TokenPurpose,
): Promise<string | null> {
  const tokenHash = hashToken(rawToken)
  const record = await VerificationToken.findOne({ tokenHash, purpose })
  if (!record) return null
  if (record.consumedAt) return null
  if (record.expiresAt.getTime() <= Date.now()) return null

  record.consumedAt = new Date()
  await record.save()
  return record.userId.toString()
}
