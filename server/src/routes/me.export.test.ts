import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'
import { Task } from '../models/Task'

async function seedMatter(userId: string, title: string): Promise<void> {
  await Task.collection.insertOne({
    userId: new Types.ObjectId(userId),
    title,
    domain: 'home',
    status: 'open',
    createdAt: new Date(),
  })
}

describe('GET /me/export', () => {
  it('returns the caller’s own data as a download', async () => {
    const s = await signUp()
    await seedMatter(s.userId, 'Renew passport')

    const res = await request.get('/me/export').set('Authorization', auth(s.accessToken))

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.headers['content-disposition']).toContain('kitto-export-')

    const body = JSON.parse(res.text)
    expect(body.version).toBe(1)
    expect(body.user.email).toBe(s.email)
    expect(body.matters.count).toBe(1)
    expect(body.matters.items[0].title).toBe('Renew passport')
    expect(body.matters.truncated).toBe(false)
  })

  it('never includes another account’s rows', async () => {
    const mine = await signUp()
    const theirs = await signUp()
    await seedMatter(mine.userId, 'Mine')
    await seedMatter(theirs.userId, 'Theirs')

    const res = await request.get('/me/export').set('Authorization', auth(mine.accessToken))

    expect(res.status).toBe(200)
    expect(res.text).toContain('Mine')
    expect(res.text).not.toContain('Theirs')
  })

  it('never leaks a credential', async () => {
    const s = await signUp()
    const res = await request.get('/me/export').set('Authorization', auth(s.accessToken))

    // The session rows ship (device history is genuinely the user's), but the
    // hash that would let someone mint a session must not.
    expect(res.text).not.toContain('passwordHash')
    expect(res.text).not.toContain('tokenHash')
    expect(res.text).not.toContain('storageKey')

    const body = JSON.parse(res.text)
    expect(body.sessions.count).toBeGreaterThan(0)
    expect(body.sessions.items[0].tokenHash).toBeUndefined()
  })

  it('rejects unauthenticated callers', async () => {
    expect((await request.get('/me/export')).status).toBe(401)
  })
})
