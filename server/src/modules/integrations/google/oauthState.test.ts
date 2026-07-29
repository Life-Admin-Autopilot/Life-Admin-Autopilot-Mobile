import { describe, expect, it, vi } from 'vitest'
import { InvalidOAuthStateError, issueOAuthState, verifyOAuthState } from './oauthState'

const USER = '507f1f77bcf86cd799439011'

describe('oauthState', () => {
  it('round-trips the user it was minted for', () => {
    expect(verifyOAuthState(issueOAuthState(USER)).userId).toBe(USER)
  })

  it('carries the web flag through the signature', () => {
    // Read from the SIGNED payload, never the callback query — the callback is
    // unauthenticated, so a query-supplied flag would let an attacker choose
    // where our OAuth exit sends the user.
    expect(verifyOAuthState(issueOAuthState(USER, true)).web).toBe(true)
    expect(verifyOAuthState(issueOAuthState(USER)).web).toBe(false)
  })

  it('issues a different state every time', () => {
    // The nonce is what stops an identical payload being replayed inside the
    // validity window.
    expect(issueOAuthState(USER)).not.toBe(issueOAuthState(USER))
  })

  it('rejects a forged subject', () => {
    // THE attack this module exists to stop. The callback is an unauthenticated
    // GET, so a state an attacker can rewrite means they choose whose account
    // the Google tokens land on.
    const state = issueOAuthState(USER)
    const [body] = state.split('.')
    const claims = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as {
      uid: string
      exp: number
      n: string
    }
    claims.uid = '507f1f77bcf86cd799439099'
    const forged = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')

    expect(() => verifyOAuthState(`${forged}.${state.split('.')[1]}`)).toThrow(
      InvalidOAuthStateError,
    )
  })

  it('rejects a tampered signature', () => {
    const [body, sig] = issueOAuthState(USER).split('.')
    expect(() => verifyOAuthState(`${body}.${sig!.slice(0, -1)}x`)).toThrow(InvalidOAuthStateError)
  })

  it('rejects a signature of the wrong length without throwing on the comparison', () => {
    // timingSafeEqual throws on mismatched buffer lengths rather than returning
    // false, so the length guard has to come first — otherwise a short
    // signature is a 500 instead of a clean rejection.
    const [body] = issueOAuthState(USER).split('.')
    expect(() => verifyOAuthState(`${body}.short`)).toThrow(InvalidOAuthStateError)
  })

  it('rejects malformed and missing states', () => {
    for (const bad of [undefined, '', 'nodot', 'a.b.c']) {
      expect(() => verifyOAuthState(bad)).toThrow(InvalidOAuthStateError)
    }
  })

  it('rejects an expired state', () => {
    const state = issueOAuthState(USER)
    // 11 minutes on: past the 10-minute window.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    try {
      expect(() => verifyOAuthState(state)).toThrow(/expired/)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('rejects a payload whose body is not valid JSON', () => {
    // Signed garbage still must not reach JSON.parse unguarded — a signing key
    // is not a guarantee the body is well formed, only that we produced it.
    const body = Buffer.from('not json', 'utf8').toString('base64url')
    const state = issueOAuthState(USER)
    // Deliberately pair a real signature with a different body: this must fail
    // at the signature check, proving the two are bound together.
    expect(() => verifyOAuthState(`${body}.${state.split('.')[1]}`)).toThrow(InvalidOAuthStateError)
  })
})
