import { describe, expect, it } from 'vitest'
import {
  DecryptionFailedError,
  decryptSecret,
  encryptSecret,
  isTokenCipherConfigured,
} from './tokenCipher'

const TOKEN = '1//0eXaMpLe-refresh-token_with.punctuation'

describe('tokenCipher', () => {
  it('is configured in the test environment', () => {
    expect(isTokenCipherConfigured()).toBe(true)
  })

  it('round-trips a token', () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN)
  })

  it('round-trips unicode and empty strings', () => {
    for (const value of ['', 'مرحبا', '🔐 emoji', 'a'.repeat(4096)]) {
      expect(decryptSecret(encryptSecret(value))).toBe(value)
    }
  })

  it('produces different ciphertext each time', () => {
    // A fresh random IV per encryption. Reusing a nonce under GCM is
    // catastrophic — it leaks the XOR of two plaintexts and, worse, allows
    // forging the auth tag. Identical output for identical input would be the
    // visible symptom.
    const a = encryptSecret(TOKEN)
    const b = encryptSecret(TOKEN)
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe(decryptSecret(b))
  })

  it('never stores the plaintext in the payload', () => {
    expect(encryptSecret(TOKEN)).not.toContain('refresh-token')
  })

  it('rejects tampered ciphertext', () => {
    // The whole reason for GCM over CBC: an attacker with write access to the
    // database must not be able to flip bits and have us decrypt their choice
    // of garbage without noticing.
    const payload = encryptSecret(TOKEN)
    const parts = payload.split('.')
    const flipped = Buffer.from(parts[3]!, 'base64url')
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff
    parts[3] = flipped.toString('base64url')

    expect(() => decryptSecret(parts.join('.'))).toThrow(DecryptionFailedError)
  })

  it('rejects a tampered auth tag', () => {
    const parts = encryptSecret(TOKEN).split('.')
    const tag = Buffer.from(parts[2]!, 'base64url')
    tag[0] = (tag[0]! ^ 0xff) & 0xff
    parts[2] = tag.toString('base64url')

    expect(() => decryptSecret(parts.join('.'))).toThrow(DecryptionFailedError)
  })

  it('rejects an unknown version rather than guessing', () => {
    const parts = encryptSecret(TOKEN).split('.')
    parts[0] = 'v2'
    expect(() => decryptSecret(parts.join('.'))).toThrow(/unknown version/)
  })

  it('rejects malformed payloads', () => {
    for (const bad of ['', 'garbage', 'v1.only.three', 'v1.a.b.c.d']) {
      expect(() => decryptSecret(bad)).toThrow(DecryptionFailedError)
    }
  })

  it('rejects a wrong-length IV', () => {
    const parts = encryptSecret(TOKEN).split('.')
    parts[1] = Buffer.alloc(8).toString('base64url')
    expect(() => decryptSecret(parts.join('.'))).toThrow(/iv length/)
  })
})
