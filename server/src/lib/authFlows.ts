import { env } from '../env'
import { VerificationToken, type TokenPurpose } from '../models/VerificationToken'
import type { UserDoc } from '../models/User'
import { sendEmail } from './email'
import { generateRawToken, hashToken, ttlToMs } from './tokens'

const VERIFICATION_TTL = '24h'
const PASSWORD_RESET_TTL = '1h'
const MAGIC_LINK_TTL = '15m'

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
