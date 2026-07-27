import jwt from 'jsonwebtoken'
import { env } from '../env'
import { ttlToMs } from './tokens'

export interface AccessTokenPayload {
  sub: string
  email: string
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const expiresInSeconds = Math.floor(ttlToMs(env().JWT_ACCESS_TTL) / 1000)
  return jwt.sign(payload, env().JWT_ACCESS_SECRET, {
    expiresIn: expiresInSeconds,
    algorithm: 'HS256',
  })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  // Pin the algorithm on verify too — otherwise an attacker could swap the
  // header to `alg: none` (or another scheme) and bypass signature checks.
  const decoded = jwt.verify(token, env().JWT_ACCESS_SECRET, { algorithms: ['HS256'] })
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Invalid token payload')
  }
  const obj = decoded as Record<string, unknown>
  if (typeof obj.sub !== 'string' || typeof obj.email !== 'string') {
    throw new Error('Invalid token claims')
  }
  return { sub: obj.sub, email: obj.email }
}
