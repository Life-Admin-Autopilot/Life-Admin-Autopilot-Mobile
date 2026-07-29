// Google OAuth 2.0, server side.
//
// The flow deliberately runs entirely on the server rather than in the app:
//
//   1. Google returns `disallowed_useragent` for OAuth attempted inside an
//      embedded webview, which is exactly what the Capacitor shell is. The
//      consent screen MUST open in the system browser, so the app cannot own
//      the redirect anyway.
//   2. The server needs the refresh token regardless — background polling runs
//      while the phone is asleep.
//   3. Keeping the refresh token off the device means a stolen phone does not
//      hand over someone's calendar.
//
// So the app opens a URL and waits for a deep link; every secret stays here.

import { env } from '../../../env'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

/**
 * Read-only, and narrow on purpose.
 *
 * `calendar.readonly` and `tasks.readonly` are SENSITIVE scopes — they need
 * Google verification (~10 days: demo video, verified domain, privacy policy)
 * but NOT a CASA security assessment. Asking for the writable `calendar` or
 * `tasks` scopes would buy nothing today and widen the review.
 */
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/tasks.readonly',
] as const

export const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar.readonly'
export const SCOPE_TASKS = 'https://www.googleapis.com/auth/tasks.readonly'

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super('Google is not configured on this server.')
    this.name = 'GoogleNotConfiguredError'
  }
}

export class GoogleOAuthError extends Error {
  readonly needsReauth: boolean
  constructor(message: string, needsReauth = false) {
    super(message)
    this.name = 'GoogleOAuthError'
    this.needsReauth = needsReauth
  }
}

export function isGoogleConfigured(): boolean {
  const e = env()
  return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET && e.GOOGLE_REDIRECT_URI)
}

function config(): { clientId: string; clientSecret: string; redirectUri: string } {
  const e = env()
  if (!e.GOOGLE_CLIENT_ID || !e.GOOGLE_CLIENT_SECRET || !e.GOOGLE_REDIRECT_URI) {
    throw new GoogleNotConfiguredError()
  }
  return {
    clientId: e.GOOGLE_CLIENT_ID,
    clientSecret: e.GOOGLE_CLIENT_SECRET,
    redirectUri: e.GOOGLE_REDIRECT_URI,
  }
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = config()
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('state', state)
  // Without access_type=offline Google issues no refresh token at all, and the
  // connection dies silently an hour later.
  url.searchParams.set('access_type', 'offline')
  // And without prompt=consent it only issues one on the user's FIRST ever
  // consent — so anyone who connects, disconnects, and reconnects would get an
  // access token with no way to renew it. This is the single most commonly
  // missed parameter in Google OAuth.
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  return url.toString()
}

export interface GoogleTokens {
  accessToken: string
  /** Absent on refresh responses — only the initial exchange returns one. */
  refreshToken?: string
  expiresAt: Date
  /** What Google ACTUALLY granted, which may be less than we asked for. */
  grantedScopes: string[]
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15_000),
  })

  const json = (await response.json().catch(() => ({}))) as TokenResponse

  if (!response.ok) {
    // invalid_grant means the refresh token is dead — the user revoked access
    // in their Google account, changed their password, or it simply expired
    // after six months of disuse. It is NOT retryable, and treating it as a
    // transient failure would retry forever while the user sees nothing.
    const needsReauth = json.error === 'invalid_grant'
    throw new GoogleOAuthError(
      json.error_description ?? json.error ?? `Google returned ${response.status}`,
      needsReauth,
    )
  }
  return json
}

function toTokens(json: TokenResponse): GoogleTokens {
  if (!json.access_token) throw new GoogleOAuthError('Google returned no access token.')
  // Expire a minute early so a token cannot lapse mid-request.
  const ttl = (json.expires_in ?? 3600) - 60
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + ttl * 1000),
    grantedScopes: json.scope ? json.scope.split(' ').filter(Boolean) : [],
  }
}

/**
 * Claims we take from the id_token.
 *
 * The signature is NOT verified, and that is correct here rather than lazy:
 * this token came straight from Google's token endpoint over TLS in a request
 * we initiated, which Google's own documentation names as the case where
 * verification can be skipped. An id_token arriving from anywhere else would
 * have to be verified.
 */
export interface GoogleIdentity {
  sub: string
  email?: string
}

export function decodeIdentity(idToken: string | undefined): GoogleIdentity | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string
      email?: string
    }
    return claims.sub ? { sub: claims.sub, email: claims.email } : null
  } catch {
    return null
  }
}

export async function exchangeCode(
  code: string,
): Promise<{ tokens: GoogleTokens; identity: GoogleIdentity | null }> {
  const { clientId, clientSecret, redirectUri } = config()
  const json = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  return { tokens: toTokens(json), identity: decodeIdentity(json.id_token) }
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const { clientId, clientSecret } = config()
  const json = await postToken({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  return toTokens(json)
}

/**
 * Tell Google to forget us. Best-effort by design: if this fails the local row
 * is still deleted, because a user who pressed Disconnect must not be left
 * connected by a network blip on our side.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
}
