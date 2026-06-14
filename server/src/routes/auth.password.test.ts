import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'

describe('POST /auth/change-password', () => {
  it('rejects a wrong current password', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-password')
      .set('Authorization', auth(s.accessToken))
      .send({ currentPassword: 'wrong', newPassword: 'newpassword456' })
    expect(res.status).toBe(401)
  })

  it('rejects a new password identical to the current one', async () => {
    const s = await signUp('password123')
    const res = await request
      .post('/auth/change-password')
      .set('Authorization', auth(s.accessToken))
      .send({ currentPassword: 'password123', newPassword: 'password123' })
    expect(res.status).toBe(400)
  })

  it('changes the password and lets the user sign in with the new one', async () => {
    const s = await signUp('password123')
    const change = await request
      .post('/auth/change-password')
      .set('Authorization', auth(s.accessToken))
      .send({ currentPassword: 'password123', newPassword: 'newpassword456' })
    expect(change.status).toBe(204)

    const signin = await request
      .post('/auth/signin')
      .send({ email: s.email, password: 'newpassword456' })
    expect(signin.status).toBe(200)
  })

  it('keeps the current session but revokes other sessions', async () => {
    const s = await signUp('password123')
    // A second session for the same user (another device).
    const other = await request
      .post('/auth/signin')
      .send({ email: s.email, password: 'password123' })
    const otherRefresh = other.body.tokens.refreshToken as string

    const change = await request
      .post('/auth/change-password')
      .set('Authorization', auth(s.accessToken))
      .send({
        currentPassword: 'password123',
        newPassword: 'newpassword456',
        refreshToken: s.refreshToken,
      })
    expect(change.status).toBe(204)

    // Current device's refresh token still rotates fine.
    const mine = await request.post('/auth/refresh').send({ refreshToken: s.refreshToken })
    expect(mine.status).toBe(200)

    // The other device is signed out.
    const theirs = await request.post('/auth/refresh').send({ refreshToken: otherRefresh })
    expect(theirs.status).toBe(401)
  })
})
