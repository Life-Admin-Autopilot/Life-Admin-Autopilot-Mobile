// The `state` parameter, signed.
//
// This is the CSRF boundary of the whole OAuth flow, and getting it wrong is
// not a subtle bug. The callback arrives as an unauthenticated GET from
// Google's redirect — there is no session cookie and no Authorization header on
// it, so the ONLY thing telling us which Kitto account to attach the tokens to
// is `state`. If an attacker can forge or replay it, they can make their own
// Google account get bound to someone else's Kitto account, and from then on
// the victim's imported matters are the attacker's data. (The reverse — binding
// a victim's Google account into an attacker's Kitto account — leaks the
// victim's calendar outright.)
//
// So: HMAC-SHA256 over the user id plus an expiry plus a nonce.
//
// The signing key is DERIVED from JWT_ACCESS_SECRET rather than being it. That
// domain separation means a state token can never be presented as a session
// token, or vice versa, even if some future code path confuses the two.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from '../../../env'

// A user has to get through Google's consent screen in this window. Generous
// enough for reading the permissions and picking an account, short enough that
// a leaked URL from a browser history is useless.
const STATE_TTL_MS = 10 * 60_000

export class InvalidOAuthStateError extends Error {
  constructor(reason: string) {
    super(`OAuth state rejected: ${reason}`)
    this.name = 'InvalidOAuthStateError'
  }
}

interface StatePayload {
  /** Kitto user id this consent belongs to. */
  uid: string
  /** Expiry, epoch ms. */
  exp: number
  /** Defeats replay of an identical payload within the window. */
  n: string
  /**
   * Consent was started from a browser rather than the native shell.
   *
   * Carried in the SIGNED state rather than read from the callback query,
   * because the callback is unauthenticated — anything an attacker can set
   * there could redirect our OAuth exit wherever they liked. Here it is
   * tamper-proof by construction.
   */
  w?: boolean
}

function signingKey(): Buffer {
  return createHmac('sha256', env().JWT_ACCESS_SECRET).update('kitto:oauth-state:v1').digest()
}

function sign(body: string): string {
  return createHmac('sha256', signingKey()).update(body).digest('base64url')
}

export interface OAuthStateClaims {
  userId: string
  /** True when the flow began in a plain browser, so there is no app to deep-link back into. */
  web: boolean
}

export function issueOAuthState(userId: string, web = false): string {
  const payload: StatePayload = {
    uid: userId,
    exp: Date.now() + STATE_TTL_MS,
    n: randomBytes(9).toString('base64url'),
    ...(web ? { w: true } : {}),
  }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body)}`
}

/** Returns the claims the state was minted with, or throws. */
export function verifyOAuthState(state: string | undefined): OAuthStateClaims {
  if (!state) throw new InvalidOAuthStateError('missing')

  const parts = state.split('.')
  if (parts.length !== 2) throw new InvalidOAuthStateError('malformed')

  const [body, signature] = parts
  if (!body || !signature) throw new InvalidOAuthStateError('malformed')

  const expected = sign(body)
  const provided = Buffer.from(signature)
  const computed = Buffer.from(expected)
  // Length must match before timingSafeEqual, which throws on mismatched
  // buffers rather than returning false. Compared in constant time so the
  // signature cannot be recovered a byte at a time by timing the response.
  if (provided.length !== computed.length || !timingSafeEqual(provided, computed)) {
    throw new InvalidOAuthStateError('bad signature')
  }

  let payload: StatePayload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload
  } catch {
    throw new InvalidOAuthStateError('unreadable payload')
  }

  if (typeof payload.uid !== 'string' || payload.uid.length === 0) {
    throw new InvalidOAuthStateError('no subject')
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
    throw new InvalidOAuthStateError('expired')
  }

  return { userId: payload.uid, web: payload.w === true }
}
