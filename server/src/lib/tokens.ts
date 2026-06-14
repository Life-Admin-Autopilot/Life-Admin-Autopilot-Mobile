import { createHash, randomBytes } from 'node:crypto'

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
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
