import { isValidObjectId } from 'mongoose'
import { env } from '../env'
import { RefreshToken } from '../models/RefreshToken'
import { User, type UserDoc } from '../models/User'
import { signAccessToken } from './jwt'
import { generateRawToken, hashToken, ttlToMs } from './tokens'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
}

export interface SessionMeta {
  userAgent?: string
  ip?: string
}

export interface SessionSummary {
  id: string
  current: boolean
  userAgent?: string
  ip?: string
  createdAt?: Date
  lastUsedAt?: Date
}

export async function issueSession(
  user: UserDoc,
  replacePrevious?: string,
  meta?: SessionMeta,
): Promise<SessionTokens> {
  const accessToken = signAccessToken({ sub: user.id, email: user.email })

  const refreshToken = generateRawToken()
  const tokenHash = hashToken(refreshToken)
  const expiresAt = new Date(Date.now() + ttlToMs(env().JWT_REFRESH_TTL))

  await RefreshToken.create({
    userId: user._id,
    tokenHash,
    expiresAt,
    userAgent: meta?.userAgent,
    ip: meta?.ip,
    lastUsedAt: new Date(),
  })

  if (replacePrevious) {
    await RefreshToken.updateOne(
      { tokenHash: hashToken(replacePrevious) },
      { $set: { revokedAt: new Date(), replacedBy: tokenHash } },
    )
  }

  return { accessToken, refreshToken }
}

export async function rotateRefreshToken(
  rawToken: string,
  meta?: SessionMeta,
): Promise<SessionTokens | null> {
  const tokenHash = hashToken(rawToken)
  const existing = await RefreshToken.findOne({ tokenHash })
  if (!existing) return null

  if (existing.revokedAt) {
    // Token reuse — revoke the entire family for this user.
    await RefreshToken.updateMany(
      { userId: existing.userId, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    )
    return null
  }

  if (existing.expiresAt.getTime() <= Date.now()) return null

  const user = await User.findById(existing.userId)
  if (!user) return null

  // Carry forward the device metadata so the rotated token stays attributable.
  return issueSession(user, rawToken, {
    userAgent: meta?.userAgent ?? existing.userAgent,
    ip: meta?.ip ?? existing.ip,
  })
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken) },
    { $set: { revokedAt: new Date() } },
  )
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  )
}

// -- Session management (settings → security) -----------------------------

export async function listUserSessions(
  userId: string,
  currentRawToken?: string,
): Promise<SessionSummary[]> {
  const currentHash = currentRawToken ? hashToken(currentRawToken) : null
  const tokens = await RefreshToken.find({
    userId,
    revokedAt: { $exists: false },
  })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .lean()

  return tokens.map((t) => ({
    id: String(t._id),
    current: currentHash != null && t.tokenHash === currentHash,
    userAgent: t.userAgent,
    ip: t.ip,
    createdAt: t.createdAt as Date | undefined,
    lastUsedAt: t.lastUsedAt,
  }))
}

// Revoke one session by its document id, scoped to the owning user. Returns
// false when no matching active session exists (already revoked or not owned).
export async function revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
  if (!isValidObjectId(sessionId)) return false
  const result = await RefreshToken.updateOne(
    { _id: sessionId, userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  )
  return result.modifiedCount > 0
}

// Revoke every active session for the user except the one matching currentRawToken.
export async function revokeOtherSessions(
  userId: string,
  currentRawToken: string,
): Promise<void> {
  await RefreshToken.updateMany(
    {
      userId,
      revokedAt: { $exists: false },
      tokenHash: { $ne: hashToken(currentRawToken) },
    },
    { $set: { revokedAt: new Date() } },
  )
}
