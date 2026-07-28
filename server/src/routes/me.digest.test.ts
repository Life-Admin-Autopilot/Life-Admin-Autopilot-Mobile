import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../models/Task'
import { auth, request, signUp } from '../test/helpers'

// The route is not gated on AI availability, so both states must produce a 200.
let aiConfigured = false
const generateContent = vi.fn()

vi.mock('../modules/ai/provider/geminiClient', () => ({
  isAiConfigured: () => aiConfigured,
  getGeminiClient: () => ({
    models: { generateContent: (...args: unknown[]) => generateContent(...(args as [])) },
  }),
  __resetGeminiClientForTests: () => {},
}))

afterEach(() => {
  aiConfigured = false
  generateContent.mockReset()
})

describe('GET /me/digest', () => {
  it('requires authentication', async () => {
    const res = await request.get('/me/digest')
    expect(res.status).toBe(401)
  })

  it('returns the digest envelope with every contracted field', async () => {
    const session = await signUp()
    await Task.create({
      userId: new Types.ObjectId(session.userId),
      title: 'Renew road tax',
      domain: 'car',
      dueAt: new Date(),
    })

    const res = await request
      .get('/me/digest?tz=Europe/London')
      .set('Authorization', auth(session.accessToken))

    expect(res.status).toBe(200)
    const { digest } = res.body
    expect(digest.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(typeof digest.generatedAt).toBe('string')
    expect(typeof digest.headline).toBe('string')
    expect(Object.keys(digest.counts).sort()).toEqual([
      'completedToday',
      'dueToday',
      'needsInput',
      'openTotal',
      'scansAwaitingReview',
      'slipping',
    ])
    expect(digest.estimatedMinutesToday).toEqual({ min: 0, max: 0 })
    expect(digest.themes).toEqual([])
    expect(digest.duplicates).toEqual([])
    expect(digest).toHaveProperty('busiestDay')
  })

  it('scopes the digest to the caller', async () => {
    const mine = await signUp()
    const theirs = await signUp()
    await Task.create({
      userId: new Types.ObjectId(theirs.userId),
      title: 'Not mine',
      domain: 'home',
      dueAt: new Date(),
    })

    const res = await request.get('/me/digest').set('Authorization', auth(mine.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.digest.counts.openTotal).toBe(0)
  })

  it('rejects an unknown query parameter rather than ignoring it', async () => {
    const session = await signUp()
    const res = await request
      .get('/me/digest?timezone=Europe/London')
      .set('Authorization', auth(session.accessToken))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_query')
  })

  it('still answers 200 when the model is configured but broken', async () => {
    const session = await signUp()
    await Task.create({
      userId: new Types.ObjectId(session.userId),
      title: 'Renew road tax',
      domain: 'car',
      dueAt: new Date(),
    })
    aiConfigured = true
    generateContent.mockRejectedValue(new Error('gemini exploded'))

    const res = await request
      .get('/me/digest?tz=Europe/London')
      .set('Authorization', auth(session.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.digest.counts.openTotal).toBe(1)
    expect(res.body.digest.headline.length).toBeGreaterThan(0)
  })

  it('still answers 200 for a timezone that is not a real zone', async () => {
    const session = await signUp()
    const res = await request
      .get('/me/digest?tz=Mars/Olympus')
      .set('Authorization', auth(session.accessToken))

    expect(res.status).toBe(200)
    expect(res.body.digest.localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
