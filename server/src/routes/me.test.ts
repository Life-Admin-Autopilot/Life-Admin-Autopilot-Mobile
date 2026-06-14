import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'

describe('PATCH /me — settings fields', () => {
  it('persists theme and textSize, returned by /auth/me', async () => {
    const s = await signUp()
    const patch = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ theme: 'dark', textSize: 'lg' })

    expect(patch.status).toBe(200)
    expect(patch.body.user.theme).toBe('dark')
    expect(patch.body.user.textSize).toBe('lg')

    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.body.user.theme).toBe('dark')
    expect(me.body.user.textSize).toBe('lg')
  })

  it('merges a nested notifications patch without clobbering siblings', async () => {
    const s = await signUp()
    // Defaults: { push: true, emailDigest: true, marketing: false }
    const patch = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ notifications: { marketing: true } })

    expect(patch.status).toBe(200)
    expect(patch.body.user.notifications.marketing).toBe(true)
    // push and emailDigest must survive the partial update.
    expect(patch.body.user.notifications.push).toBe(true)
    expect(patch.body.user.notifications.emailDigest).toBe(true)
  })

  it('rejects an invalid mic quality', async () => {
    const s = await signUp()
    const res = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ mic: { quality: 'studio' } })
    expect(res.status).toBe(400)
  })

  it('never exposes passwordHash', async () => {
    const s = await signUp()
    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.body.user.passwordHash).toBeUndefined()
  })
})

describe('DELETE /me', () => {
  it('requires the correct password for password accounts', async () => {
    const s = await signUp('password123')
    const wrong = await request
      .delete('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ password: 'nope' })
    expect(wrong.status).toBe(401)

    const missing = await request.delete('/me').set('Authorization', auth(s.accessToken)).send({})
    expect(missing.status).toBe(400)
  })

  it('deletes the account and invalidates the session', async () => {
    const s = await signUp('password123')
    const del = await request
      .delete('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ password: 'password123' })
    expect(del.status).toBe(204)

    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.status).toBe(404)

    // Refresh token is gone too — cannot resurrect a session.
    const refresh = await request.post('/auth/refresh').send({ refreshToken: s.refreshToken })
    expect(refresh.status).toBe(401)
  })
})

describe('settings read endpoints', () => {
  it('GET /me/subscription defaults to the free tier', async () => {
    const s = await signUp()
    const res = await request.get('/me/subscription').set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.subscription.tier).toBe('free')
  })

  it('GET /me/billing/invoices returns an empty list', async () => {
    const s = await signUp()
    const res = await request.get('/me/billing/invoices').set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.invoices).toEqual([])
  })

  it('GET /me/integrations returns an empty list', async () => {
    const s = await signUp()
    const res = await request.get('/me/integrations').set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.integrations).toEqual([])
  })

  it('rejects unauthenticated reads', async () => {
    const res = await request.get('/me/subscription')
    expect(res.status).toBe(401)
  })
})
