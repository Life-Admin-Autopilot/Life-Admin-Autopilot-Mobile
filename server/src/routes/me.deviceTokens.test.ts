import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'
import { User } from '../models/User'

describe('POST /me/device-tokens', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request
      .post('/me/device-tokens')
      .send({ token: 'ExponentPushToken[x]', platform: 'ios' })
    expect(res.status).toBe(401)
  })

  it('registers a device token', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/device-tokens')
      .set('Authorization', auth(session.accessToken))
      .send({ token: 'ExponentPushToken[abc]', platform: 'android' })
    expect(res.status).toBe(200)
    expect(res.body.count).toBe(1)

    const user = await User.findById(session.userId)
    expect(user?.deviceTokens[0]?.token).toBe('ExponentPushToken[abc]')
    expect(user?.deviceTokens[0]?.platform).toBe('android')
  })

  it('dedupes the same token without growing the list', async () => {
    const session = await signUp()
    const body = { token: 'ExponentPushToken[dup]', platform: 'ios' as const }
    await request.post('/me/device-tokens').set('Authorization', auth(session.accessToken)).send(body)
    const res = await request
      .post('/me/device-tokens')
      .set('Authorization', auth(session.accessToken))
      .send(body)
    expect(res.body.count).toBe(1)
  })

  it('rejects an invalid platform', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/device-tokens')
      .set('Authorization', auth(session.accessToken))
      .send({ token: 'tok', platform: 'blackberry' })
    expect(res.status).toBe(400)
  })
})
