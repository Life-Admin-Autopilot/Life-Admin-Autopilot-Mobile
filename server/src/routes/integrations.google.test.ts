import { describe, expect, it, vi } from 'vitest'

import { Integration } from '../models/Integration'
import { encryptSecret } from '../lib/tokenCipher'
import { issueOAuthState } from '../modules/integrations/google/oauthState'
import { auth, request, signUp } from '../test/helpers'

// Google credentials are absent in the test env, so `ready()` is false and the
// authorize leg refuses. Tests that need it configured stub the two guards.
vi.mock('../modules/integrations/google/oauthClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../modules/integrations/google/oauthClient')>()
  return {
    ...actual,
    isGoogleConfigured: () => true,
    buildAuthorizeUrl: (state: string) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
    exchangeCode: vi.fn(async () => ({
      tokens: {
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: new Date(Date.now() + 3_600_000),
        grantedScopes: [
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/tasks.readonly',
        ],
      },
      identity: { sub: 'google-user-1', email: 'someone@gmail.com' },
    })),
  }
})

describe('POST /integrations/google/authorize', () => {
  it('requires a session', async () => {
    const res = await request.post('/integrations/google/authorize')
    expect(res.status).toBe(401)
  })

  it('returns a consent URL carrying a signed state', async () => {
    const s = await signUp()
    const res = await request
      .post('/integrations/google/authorize')
      .set('Authorization', auth(s.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.url).toContain('accounts.google.com')
    expect(res.body.url).toContain('state=')
  })
})

describe('GET /integrations/google/callback', () => {
  it('redirects to the app rather than returning JSON', async () => {
    // The user is looking at a system browser tab. A JSON error body is both
    // useless to them and a dead end — the app waits for a deep link forever.
    const res = await request.get('/integrations/google/callback').query({ state: 'nonsense' })

    expect(res.status).toBe(302)
    expect(res.headers.location).toMatch(/^kitto:\/\/integrations\/google/)
    expect(res.headers.location).toContain('status=error')
  })

  it('refuses a forged state', async () => {
    // THE attack. The callback is unauthenticated, so an attacker who can forge
    // state chooses whose Kitto account their Google tokens land on.
    const s = await signUp()
    const real = issueOAuthState(s.userId)
    const [body, sig] = real.split('.')

    const res = await request
      .get('/integrations/google/callback')
      .query({ state: `${body}.${sig!.slice(0, -1)}x`, code: 'whatever' })

    expect(res.headers.location).toContain('reason=invalid_state')
    expect(await Integration.countDocuments({})).toBe(0)
  })

  it('does not leak which check failed', async () => {
    // Forged vs expired vs malformed are all the same to the caller: either an
    // attack or a stale tab, and neither earns a diagnosis.
    const res = await request.get('/integrations/google/callback').query({ state: 'a.b' })
    expect(res.headers.location).toContain('reason=invalid_state')
    expect(res.headers.location).not.toContain('signature')
  })

  it('treats a declined consent as cancelled, not an error', async () => {
    const res = await request
      .get('/integrations/google/callback')
      .query({ error: 'access_denied' })

    expect(res.headers.location).toContain('status=cancelled')
  })

  it('stores the connection for the user named in the state', async () => {
    const s = await signUp()
    const res = await request
      .get('/integrations/google/callback')
      .query({ state: issueOAuthState(s.userId), code: 'good-code' })

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('status=connected')

    const stored = await Integration.findOne({ provider: 'google' })
    expect(String(stored?.userId)).toBe(s.userId)
    expect(stored?.externalAccountEmail).toBe('someone@gmail.com')
    expect(stored?.status).toBe('active')
  })

  it('never stores a token in plaintext', async () => {
    const s = await signUp()
    await request
      .get('/integrations/google/callback')
      .query({ state: issueOAuthState(s.userId), code: 'good-code' })

    const raw = await Integration.collection.findOne({ provider: 'google' })
    expect(JSON.stringify(raw)).not.toContain('refresh-1')
    expect(JSON.stringify(raw)).not.toContain('access-1')
  })

  it('rejects a missing code', async () => {
    const s = await signUp()
    const res = await request
      .get('/integrations/google/callback')
      .query({ state: issueOAuthState(s.userId) })

    expect(res.headers.location).toContain('reason=no_code')
  })
})

describe('GET /integrations/google', () => {
  it('reports not-connected for a fresh account', async () => {
    const s = await signUp()
    const res = await request.get('/integrations/google').set('Authorization', auth(s.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.integration).toBeNull()
  })

  it('never returns token fields', async () => {
    const s = await signUp()
    await Integration.create({
      userId: s.userId,
      provider: 'google',
      externalAccountId: 'google-user-1',
      externalAccountEmail: 'someone@gmail.com',
      refreshTokenEnc: encryptSecret('refresh-1'),
      accessTokenEnc: encryptSecret('access-1'),
      grantedScopes: ['https://www.googleapis.com/auth/tasks.readonly'],
      status: 'active',
      connectedAt: new Date(),
    })

    const res = await request.get('/integrations/google').set('Authorization', auth(s.accessToken))

    expect(res.body.integration.externalAccountEmail).toBe('someone@gmail.com')
    expect(res.body.integration.refreshTokenEnc).toBeUndefined()
    expect(res.body.integration.accessTokenEnc).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('refresh-1')
  })

  it('does not expose another user’s connection', async () => {
    const owner = await signUp()
    const other = await signUp()
    await Integration.create({
      userId: owner.userId,
      provider: 'google',
      externalAccountId: 'google-user-1',
      refreshTokenEnc: encryptSecret('refresh-1'),
      grantedScopes: [],
      status: 'active',
      connectedAt: new Date(),
    })

    const res = await request
      .get('/integrations/google')
      .set('Authorization', auth(other.accessToken))

    expect(res.body.integration).toBeNull()
  })
})

describe('DELETE /integrations/google', () => {
  it('removes the stored connection', async () => {
    const s = await signUp()
    await Integration.create({
      userId: s.userId,
      provider: 'google',
      externalAccountId: 'google-user-1',
      refreshTokenEnc: encryptSecret('refresh-1'),
      grantedScopes: [],
      status: 'active',
      connectedAt: new Date(),
    })

    const res = await request
      .delete('/integrations/google')
      .set('Authorization', auth(s.accessToken))

    expect(res.status).toBe(200)
    expect(await Integration.countDocuments({ userId: s.userId })).toBe(0)
  })

  it('404s when nothing is connected', async () => {
    const s = await signUp()
    const res = await request
      .delete('/integrations/google')
      .set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(404)
  })
})
