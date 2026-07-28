import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'
import { AiConversation } from '../models/AiConversation'
import { AiUsageCounter } from '../models/AiUsageCounter'
import { Clarification } from '../models/Clarification'
import { DailyDigest } from '../models/DailyDigest'
import { DocumentScanUsageCounter } from '../models/DocumentScanUsageCounter'
import { Notification } from '../models/Notification'
import { RefreshToken } from '../models/RefreshToken'
import { ScannedDocument } from '../models/ScannedDocument'
import { Task } from '../models/Task'
import { TaskBulkOp } from '../models/TaskBulkOp'
import { VerificationToken } from '../models/VerificationToken'
import { VoiceNote } from '../models/VoiceNote'

// Every collection that carries a userId. The cascade test walks this list, so
// adding a user-scoped model without adding it to deleteUserAndDependents fails
// here rather than silently leaking that user's rows forever.
const USER_SCOPED = [
  Task,
  TaskBulkOp,
  VoiceNote,
  ScannedDocument,
  AiConversation,
  AiUsageCounter,
  DocumentScanUsageCounter,
  Clarification,
  DailyDigest,
  Notification,
  VerificationToken,
  RefreshToken,
] as const

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

  it('round-trips timezone and locale', async () => {
    const s = await signUp()
    const patch = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ timezone: 'Africa/Cairo', locale: 'en-GB' })

    expect(patch.status).toBe(200)
    expect(patch.body.user.timezone).toBe('Africa/Cairo')
    expect(patch.body.user.locale).toBe('en-GB')

    const me = await request.get('/auth/me').set('Authorization', auth(s.accessToken))
    expect(me.body.user.timezone).toBe('Africa/Cairo')
  })

  it('rejects a timezone the runtime does not recognise', async () => {
    const s = await signUp()
    const res = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ timezone: 'Mars/Olympus_Mons' })
    expect(res.status).toBe(400)
  })

  it('rejects a malformed locale', async () => {
    const s = await signUp()
    const res = await request
      .patch('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ locale: 'not a locale!' })
    expect(res.status).toBe(400)
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

  it('cascades to every user-scoped collection', async () => {
    const s = await signUp('password123')
    const userId = new Types.ObjectId(s.userId)

    // Seeded through the driver rather than the models: this is a test about
    // deletion by userId, and hand-building a schema-valid DailyDigest payload
    // would only couple it to fields it does not care about.
    await Promise.all(
      USER_SCOPED.map((model) => model.collection.insertOne({ userId, seeded: true })),
    )
    for (const model of USER_SCOPED) {
      expect(await model.collection.countDocuments({ userId })).toBeGreaterThan(0)
    }

    const del = await request
      .delete('/me')
      .set('Authorization', auth(s.accessToken))
      .send({ password: 'password123' })
    expect(del.status).toBe(204)

    for (const model of USER_SCOPED) {
      expect(
        await model.collection.countDocuments({ userId }),
        `${model.modelName} still holds rows for the deleted user`,
      ).toBe(0)
    }
  })

  it('leaves other accounts untouched', async () => {
    const mine = await signUp('password123')
    const theirs = await signUp('password123')
    const theirId = new Types.ObjectId(theirs.userId)

    await Task.collection.insertOne({ userId: theirId, seeded: true })

    await request
      .delete('/me')
      .set('Authorization', auth(mine.accessToken))
      .send({ password: 'password123' })

    expect(await Task.collection.countDocuments({ userId: theirId })).toBe(1)
    const stillThere = await request.get('/auth/me').set('Authorization', auth(theirs.accessToken))
    expect(stillThere.status).toBe(200)
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
