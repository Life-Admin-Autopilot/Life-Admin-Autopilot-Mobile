import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'

describe('session management', () => {
  it('lists active sessions and flags the current device', async () => {
    const s = await signUp('password123')
    // Open a second session.
    await request.post('/auth/signin').send({ email: s.email, password: 'password123' })

    const res = await request
      .post('/auth/sessions/list')
      .set('Authorization', auth(s.accessToken))
      .send({ refreshToken: s.refreshToken })

    expect(res.status).toBe(200)
    expect(res.body.sessions).toHaveLength(2)
    const current = res.body.sessions.filter((x: { current: boolean }) => x.current)
    expect(current).toHaveLength(1)
  })

  it('captures user-agent metadata on the session', async () => {
    const s = await signUp('password123')
    // The user-agent is recorded when the session is created, so sign in with
    // a known UA to produce an attributable session.
    await request
      .post('/auth/signin')
      .set('User-Agent', 'LifeAdmin/1.0 iPhone')
      .send({ email: s.email, password: 'password123' })

    const res = await request
      .post('/auth/sessions/list')
      .set('Authorization', auth(s.accessToken))
      .send({ refreshToken: s.refreshToken })

    const tagged = res.body.sessions.find((x: { userAgent?: string }) =>
      x.userAgent?.includes('LifeAdmin'),
    )
    expect(tagged).toBeDefined()
  })

  it('revokes a single session by id', async () => {
    const s = await signUp('password123')
    const other = await request
      .post('/auth/signin')
      .send({ email: s.email, password: 'password123' })
    const otherRefresh = other.body.tokens.refreshToken as string

    const list = await request
      .post('/auth/sessions/list')
      .set('Authorization', auth(s.accessToken))
      .send({ refreshToken: s.refreshToken })
    const otherSession = list.body.sessions.find((x: { current: boolean }) => !x.current)

    const del = await request
      .delete(`/auth/sessions/${otherSession.id}`)
      .set('Authorization', auth(s.accessToken))
    expect(del.status).toBe(204)

    const refresh = await request.post('/auth/refresh').send({ refreshToken: otherRefresh })
    expect(refresh.status).toBe(401)
  })

  it('returns 404 for an invalid session id', async () => {
    const s = await signUp('password123')
    const res = await request
      .delete('/auth/sessions/not-an-object-id')
      .set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(404)
  })

  it('revokes all other sessions but keeps the current one', async () => {
    const s = await signUp('password123')
    const other = await request
      .post('/auth/signin')
      .send({ email: s.email, password: 'password123' })
    const otherRefresh = other.body.tokens.refreshToken as string

    const res = await request
      .post('/auth/sessions/revoke-others')
      .set('Authorization', auth(s.accessToken))
      .send({ refreshToken: s.refreshToken })
    expect(res.status).toBe(204)

    const mine = await request.post('/auth/refresh').send({ refreshToken: s.refreshToken })
    expect(mine.status).toBe(200)
    const theirs = await request.post('/auth/refresh').send({ refreshToken: otherRefresh })
    expect(theirs.status).toBe(401)
  })
})
