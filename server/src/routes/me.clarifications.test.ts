import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../models/Task'
import { Clarification } from '../models/Clarification'
import { auth, request, signUp } from '../test/helpers'

// AI seam: the custom-answer path calls interpretCustomAnswer (one Gemini
// round). Stub it so the route runs deterministically; flip aiConfigured per
// test. The option path never touches AI.
let aiConfigured = true
const interpretMock = vi.fn(async () => ({}) as Record<string, unknown>)

vi.mock('../modules/ai/provider/geminiClient', () => ({
  isAiConfigured: () => aiConfigured,
  getGeminiClient: () => ({ __sentinel: true }),
  __resetGeminiClientForTests: () => {},
}))

vi.mock('../modules/ai/resolveClarificationAnswer', () => ({
  interpretCustomAnswer: (...args: unknown[]) => interpretMock(...(args as [])),
}))

afterEach(() => {
  aiConfigured = true
  interpretMock.mockReset()
})

async function hold(
  userId: string,
  over: Partial<Parameters<typeof Clarification.create>[0]> = {},
) {
  return Clarification.create({
    userId: new Types.ObjectId(userId),
    status: 'open',
    draft: { title: 'Car insurance renewal', domain: 'car', priority: 'high', tags: [] },
    question: 'Is it the 15th or the 18th?',
    kind: 'date',
    options: [
      { label: 'The 15th', dueAt: new Date('2026-06-15T09:00:00.000Z') },
      { label: 'The 18th', dueAt: new Date('2026-06-18T09:00:00.000Z') },
    ],
    ...over,
  })
}

describe('GET /me/clarifications', () => {
  it('returns only open items scoped to the caller', async () => {
    const a = await signUp()
    const b = await signUp()
    await hold(a.userId)
    await hold(a.userId, { status: 'resolved' })
    await hold(b.userId)

    const res = await request.get('/me/clarifications').set('Authorization', auth(a.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.clarifications).toHaveLength(1)
    expect(res.body.clarifications[0].question).toBe('Is it the 15th or the 18th?')
    expect(res.body.clarifications[0].id).toBeTruthy()
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request.get('/me/clarifications')
    expect(res.status).toBe(401)
  })
})

describe('POST /me/clarifications/:id/resolve — option', () => {
  it('creates a task with the picked option date and marks it resolved', async () => {
    const a = await signUp()
    const doc = await hold(a.userId)

    const res = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(a.accessToken))
      .send({ answer: { type: 'option', index: 1 } })

    expect(res.status).toBe(200)
    expect(res.body.task.title).toBe('Car insurance renewal')
    expect(res.body.task.dueAt).toBe('2026-06-18T09:00:00.000Z')
    expect(res.body.clarification.status).toBe('resolved')
    expect(res.body.clarification.answer).toBe('The 18th')

    const created = await Task.findOne({ userId: a.userId, title: 'Car insurance renewal' })
    expect(created?.dueAt?.toISOString()).toBe('2026-06-18T09:00:00.000Z')

    // No longer open → gone from the banner list.
    const list = await request.get('/me/clarifications').set('Authorization', auth(a.accessToken))
    expect(list.body.clarifications).toHaveLength(0)
  })

  it('rejects an out-of-range option index', async () => {
    const a = await signUp()
    const doc = await hold(a.userId)
    const res = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(a.accessToken))
      .send({ answer: { type: 'option', index: 3 } })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_option')
  })

  it('is idempotent — resolving twice does not create a second task', async () => {
    const a = await signUp()
    const doc = await hold(a.userId)
    const body = { answer: { type: 'option', index: 0 } }
    await request.post(`/me/clarifications/${doc.id}/resolve`).set('Authorization', auth(a.accessToken)).send(body)
    const second = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(a.accessToken))
      .send(body)
    expect(second.status).toBe(200)
    expect(second.body.task).toBeNull()
    expect(await Task.countDocuments({ userId: a.userId })).toBe(1)
  })
})

describe('POST /me/clarifications/:id/resolve — custom', () => {
  it('runs the typed answer through Mo and creates the interpreted task', async () => {
    const a = await signUp()
    const doc = await hold(a.userId)
    interpretMock.mockResolvedValueOnce({
      title: 'Car insurance renewal',
      domain: 'car',
      priority: 'high',
      dueAt: '2026-06-20T09:00:00.000+00:00',
    })

    const res = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(a.accessToken))
      .send({ answer: { type: 'custom', text: 'actually the 20th' }, timezone: 'UTC' })

    expect(res.status).toBe(200)
    expect(interpretMock).toHaveBeenCalledTimes(1)
    expect(res.body.task.dueAt).toBe('2026-06-20T09:00:00.000Z')
    expect(res.body.clarification.answer).toBe('actually the 20th')
  })

  it('returns 503 for a custom answer when AI is not configured', async () => {
    aiConfigured = false
    const a = await signUp()
    const doc = await hold(a.userId)
    const res = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(a.accessToken))
      .send({ answer: { type: 'custom', text: 'the 20th' } })
    expect(res.status).toBe(503)
    expect(interpretMock).not.toHaveBeenCalled()
  })
})

describe('POST /me/clarifications/:id/drop', () => {
  it('drops a held item without creating a task', async () => {
    const a = await signUp()
    const doc = await hold(a.userId)
    const res = await request
      .post(`/me/clarifications/${doc.id}/drop`)
      .set('Authorization', auth(a.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.clarification.status).toBe('dropped')
    expect(await Task.countDocuments({ userId: a.userId })).toBe(0)

    const list = await request.get('/me/clarifications').set('Authorization', auth(a.accessToken))
    expect(list.body.clarifications).toHaveLength(0)
  })
})

describe('ownership', () => {
  it("404s when resolving another user's clarification", async () => {
    const a = await signUp()
    const b = await signUp()
    const doc = await hold(a.userId)
    const res = await request
      .post(`/me/clarifications/${doc.id}/resolve`)
      .set('Authorization', auth(b.accessToken))
      .send({ answer: { type: 'option', index: 0 } })
    expect(res.status).toBe(404)
  })
})
