import { createHash, randomBytes, randomInt } from 'node:crypto'

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const CODE_LENGTH = 6

/** Six digits, zero-padded, from a CSPRNG — `Math.random` is not acceptable here. */
export function generateNumericCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

/**
 * Hash a short code together with the account and purpose it belongs to.
 *
 * Two reasons this is not plain `hashToken(code)`. First, six digits is a
 * 1-in-a-million space, so a bare hash is trivially precomputable AND would
 * collide across users — and `VerificationToken.tokenHash` is a UNIQUE index,
 * so one user's live code would block every other user from being issued the
 * same digits. Second, binding the userId means a code minted for one account
 * can never be redeemed against another, which is what makes a six-digit
 * secret safe at all.
 */
export function hashCode(userId: string, purpose: string, code: string): string {
  return hashToken(`${userId}:${purpose}:${code}`)
}

const TTL_PATTERN = /^(\d+)([smhd])$/
const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export function ttlToMs(ttl: string): number {
  const match = TTL_PATTERN.exec(ttl)
  if (!match) throw new Error(`Invalid TTL: ${ttl}`)
  const value = parseInt(match[1] ?? '0', 10)
  const unit = match[2] ?? ''
  const multiplier = UNIT_TO_MS[unit]
  if (!multiplier) throw new Error(`Invalid TTL unit: ${unit}`)
  return value * multiplier
}
