// Authenticated encryption for third-party tokens at rest.
//
// A Google refresh token is a long-lived bearer credential for someone's
// calendar and tasks. Stored in plaintext, one leaked database dump is
// permanent read access to every connected user's life — and unlike a password
// hash there is nothing one-way about it, because we must be able to use it.
//
// So: AES-256-GCM, which is authenticated. Not CBC, not raw CTR. Without the
// auth tag an attacker with write access to the database could flip ciphertext
// bits and we would decrypt attacker-chosen garbage without noticing.
//
// The stored form is versioned (`v1.<iv>.<tag>.<ciphertext>`, base64url) so a
// key rotation can be rolled out by teaching decrypt about `v2` while `v1` rows
// are still readable. Rotation itself is not implemented — but the format does
// not have to be redesigned when it is.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../env'

const VERSION = 'v1'
const ALGORITHM = 'aes-256-gcm'
// 96 bits is the GCM-recommended nonce length: it is the only size the spec
// uses directly rather than hashing down, and it is what every audited
// implementation expects.
const IV_BYTES = 12
const KEY_BYTES = 32

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super('INTEGRATION_ENCRYPTION_KEY is not set — connected accounts are unavailable.')
    this.name = 'EncryptionNotConfiguredError'
  }
}

export class DecryptionFailedError extends Error {
  constructor(reason: string) {
    super(`Stored credential could not be read: ${reason}`)
    this.name = 'DecryptionFailedError'
  }
}

/**
 * Whether token storage is usable at all.
 *
 * Mirrors `isAiConfigured()`: the server boots without a key so local
 * development and the test suite do not need one, and the integration routes
 * answer with a clear 503 instead of throwing deep inside a request.
 */
export function isTokenCipherConfigured(): boolean {
  return Boolean(env().INTEGRATION_ENCRYPTION_KEY)
}

function key(): Buffer {
  const raw = env().INTEGRATION_ENCRYPTION_KEY
  if (!raw) throw new EncryptionNotConfiguredError()

  const buf = Buffer.from(raw, 'hex')
  // Length is validated here as well as in env.ts because a hex string with an
  // odd character silently decodes SHORT rather than failing — and a 20-byte
  // "AES-256" key is a weakness nothing else would report.
  if (buf.length !== KEY_BYTES) {
    throw new Error(`INTEGRATION_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes of hex.`)
  }
  return buf
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.')
  if (parts.length !== 4) throw new DecryptionFailedError('malformed payload')

  const [version, ivPart, tagPart, ctPart] = parts
  if (version !== VERSION) throw new DecryptionFailedError(`unknown version ${String(version)}`)
  // The ciphertext segment may legitimately be EMPTY — encrypting "" produces
  // zero bytes, and the auth tag still proves it was us who produced them. Only
  // the IV and tag must be present, so this cannot use a plain truthiness check
  // across all three. The length check above already guarantees ctPart is a
  // defined string.
  if (!ivPart || !tagPart || ctPart === undefined) {
    throw new DecryptionFailedError('missing segment')
  }

  const iv = Buffer.from(ivPart, 'base64url')
  const tag = Buffer.from(tagPart, 'base64url')
  if (iv.length !== IV_BYTES) throw new DecryptionFailedError('bad iv length')

  try {
    const decipher = createDecipheriv(ALGORITHM, key(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // GCM's final() throws when the tag does not verify. That means the
    // ciphertext was altered or the key changed — never a recoverable state, and
    // never something to paper over by returning a partial plaintext.
    throw new DecryptionFailedError('authentication failed')
  }
}
