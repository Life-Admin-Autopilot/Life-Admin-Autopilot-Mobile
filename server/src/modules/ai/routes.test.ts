import { afterEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../../models/Task'
import { auth, request, signUp } from '../../test/helpers'
import { appendTurn } from './conversationService'
import { guardCitations } from './hallucinationGuard'
import { registerPendingCall } from './pendingToolStore'
import type { StreamEvent } from './provider/streamPersonal'

// Stub the real Gemini transcription so the 413-regression test never makes a
// network call regardless of whether GEMINI_API_KEY leaked in from another file.
vi.mock('./audioTranscriber', () => ({
  transcribeAudio: async () => 'stub transcript',
}))

// Controllable AI-layer stubs. The provider modules are the network seam:
//   - aiConfigured: a mutable flag, DEFAULT false so every existing test
//     (which relies on the 503 / continuation short-circuit when no key is
//     present) keeps its behavior. The confirm-WITH-AI test flips it on.
//   - streamPersonal: a scripted async generator so the post-confirmation
//     continuation runs deterministically without a real Gemini call.
let aiConfigured = false
let continuationScript: StreamEvent[] = []

vi.mock('./provider/geminiClient', () => ({
  isAiConfigured: () => aiConfigured,
  getGeminiClient: () => ({ __sentinel: true }),
  __resetGeminiClientForTests: () => {},
}))

vi.mock('./provider/streamPersonal', () => ({
  streamPersonal: vi.fn(async function* (): AsyncGenerator<StreamEvent> {
    const script: StreamEvent[] =
      continuationScript.length > 0 ? continuationScript : [{ kind: 'done', usage: {} }]
    for (const ev of script) {
      yield ev
    }
  }),
}))

afterEach(() => {
  aiConfigured = false
  continuationScript = []
})

describe('POST /ai/voice/transcribe — raw audio (413 regression)', () => {
  it('accepts a ~400KB raw audio body without a 413', async () => {
    const session = await signUp()
    // The old base64-in-JSON path tripped the global express.json 256KB limit
    // at ~270-400KB. Raw audio/* must sail past it.
    const big = Buffer.alloc(400 * 1024, 0x01)
    const res = await request
      .post('/ai/voice/transcribe')
      .set('Authorization', auth(session.accessToken))
      .set('Content-Type', 'audio/m4a')
      .send(big)
    expect(res.status).not.toBe(413)
    // Either transcribed (200) or 503 if the key isn't configured in this run —
    // both prove the body parser accepted the payload.
    expect([200, 503]).toContain(res.status)
  })

  it('rejects unauthenticated transcribe requests', async () => {
    const res = await request
      .post('/ai/voice/transcribe')
      .set('Content-Type', 'audio/m4a')
      .send(Buffer.from([0x00, 0x01]))
    expect(res.status).toBe(401)
  })

  it('rejects an empty audio body without a 413', async () => {
    const session = await signUp()
    const res = await request
      .post('/ai/voice/transcribe')
      .set('Authorization', auth(session.accessToken))
      .set('Content-Type', 'audio/m4a')
      .send(Buffer.alloc(0))
    expect(res.status).not.toBe(413)
  })
})

describe('GET /ai/quota', () => {
  it('returns the default free-tier message quota row', async () => {
    const session = await signUp()
    const res = await request
      .get('/ai/quota')
      .set('Authorization', auth(session.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.tier).toBe('free')
    expect(Array.isArray(res.body.quotas)).toBe(true)
    expect(res.body.quotas[0].kind).toBe('message')
    expect(res.body.quotas[0].used).toBe(0)
    expect(res.body.quotas[0].remaining).toBeGreaterThan(0)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request.get('/ai/quota')
    expect(res.status).toBe(401)
  })
})

describe('POST /ai/ask without GEMINI_API_KEY', () => {
  it('returns 503 ai_not_configured', async () => {
    const session = await signUp()
    const res = await request
      .post('/ai/ask')
      .set('Authorization', auth(session.accessToken))
      .send({ question: 'hello' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('ai_not_configured')
  })

  it('rejects empty body before checking AI config', async () => {
    const session = await signUp()
    const res = await request
      .post('/ai/ask')
      .set('Authorization', auth(session.accessToken))
      .send({ question: '' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_body')
  })
})

describe('POST /ai/tools/confirm/:callId', () => {
  it('returns 404 for a non-existent pending call', async () => {
    const session = await signUp()
    const res = await request
      .post('/ai/tools/confirm/nonexistent')
      .set('Authorization', auth(session.accessToken))
      .send({ action: 'confirm' })
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('pending_call_not_found')
  })

  it('rejects invalid action', async () => {
    const session = await signUp()
    const res = await request
      .post('/ai/tools/confirm/anything')
      .set('Authorization', auth(session.accessToken))
      .send({ action: 'maybe' })
    expect(res.status).toBe(400)
  })

  // Streaming-confirm flow: when AI isn't configured the continuation
  // step short-circuits, but the tool still runs and the `tool_result`
  // SSE event is emitted. This guards the wire shape without depending
  // on Gemini.
  it('streams a tool_result event after confirming a pending destructive call', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'gone',
      domain: 'home',
      status: 'open',
    })
    const callId = 'test-call-1'
    registerPendingCall({
      callId,
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { status: 'open' },
    })
    // Mirror the assistant turn so findPendingToolCall has something to find.
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      role: 'assistant',
      text: "I'll remove that for you.",
      toolCalls: [
        {
          callId,
          name: 'deleteAllTasks',
          args: { status: 'open' },
          status: 'pending_confirmation',
          result: null,
          error: null,
        },
      ],
    })

    const res = await request
      .post(`/ai/tools/confirm/${callId}`)
      .set('Authorization', auth(session.accessToken))
      .send({ action: 'confirm' })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')

    // Body is an SSE stream concatenated by supertest. Grab the tool_result
    // and done frames.
    const body = String(res.text ?? '')
    const frames = body
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.replace(/^data:\s*/, '')))
    const types = frames.map((f: { type: string }) => f.type)
    expect(types).toContain('tool_result')
    expect(types).toContain('done')

    const toolResult = frames.find((f: { type: string }) => f.type === 'tool_result') as {
      callId: string
      result: Record<string, unknown> | null
      error: string | null
    }
    expect(toolResult.callId).toBe(callId)
    expect(toolResult.error).toBeNull()
    expect((toolResult.result as { deleted: boolean }).deleted).toBe(true)

    // Task is actually gone from Mongo.
    // Soft delete: the row is retained for undo but carries a deletedAt.
    expect((await Task.findById(task.id))?.deletedAt).toBeInstanceOf(Date)
  })

  it('streams a declined tool_result when action=decline', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'still here',
      domain: 'home',
      status: 'open',
    })
    const callId = 'test-call-2'
    registerPendingCall({
      callId,
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { status: 'open' },
    })
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      role: 'assistant',
      text: 'About to remove that.',
      toolCalls: [
        {
          callId,
          name: 'deleteAllTasks',
          args: { status: 'open' },
          status: 'pending_confirmation',
          result: null,
          error: null,
        },
      ],
    })

    const res = await request
      .post(`/ai/tools/confirm/${callId}`)
      .set('Authorization', auth(session.accessToken))
      .send({ action: 'decline' })

    expect(res.status).toBe(200)
    const body = String(res.text ?? '')
    const frames = body
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.replace(/^data:\s*/, '')))
    const toolResult = frames.find((f: { type: string }) => f.type === 'tool_result') as {
      callId: string
      result: Record<string, unknown> | null
      error: string | null
    }
    expect(toolResult.error).toBe('declined')
    // Task survives, untouched — not even soft-deleted.
    expect((await Task.findById(task.id))?.deletedAt).toBeUndefined()
  })

  // Confirm flow WITH the AI layer mocked: after the destructive tool runs, the
  // continuation re-enters the orchestrator (streamPersonal stubbed) so Kitto can
  // react. We assert the full wire sequence — tool_result → continuation
  // token(s) → done → quota — without touching the network.
  it('runs the continuation after confirming when AI is configured', async () => {
    aiConfigured = true
    continuationScript = [
      { kind: 'token', text: 'Done — removed it.' },
      { kind: 'done', usage: { totalTokenCount: 7 } },
    ]

    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'remove me',
      domain: 'home',
      status: 'open',
    })
    const callId = 'test-call-ai'
    registerPendingCall({
      callId,
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { status: 'open' },
    })
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      role: 'assistant',
      text: 'About to remove that.',
      toolCalls: [
        {
          callId,
          name: 'deleteAllTasks',
          args: { status: 'open' },
          status: 'pending_confirmation',
          result: null,
          error: null,
        },
      ],
    })

    const res = await request
      .post(`/ai/tools/confirm/${callId}`)
      .set('Authorization', auth(session.accessToken))
      .send({ action: 'confirm' })

    expect(res.status).toBe(200)
    const body = String(res.text ?? '')
    const frames = body
      .split('\n\n')
      .filter((f) => f.startsWith('data:'))
      .map((f) => JSON.parse(f.replace(/^data:\s*/, '')))
    const types = frames.map((f: { type: string }) => f.type)

    // The tool ran, then the continuation streamed a token and finished, and
    // the refreshed quota counter was emitted.
    expect(types).toContain('tool_result')
    expect(types).toContain('token')
    expect(types).toContain('done')
    expect(types).toContain('quota')

    const token = frames.find((f: { type: string }) => f.type === 'token') as {
      text: string
    }
    expect(token.text).toBe('Done — removed it.')

    // The destructive tool actually deleted the task.
    // Soft delete: the row is retained for undo but carries a deletedAt.
    expect((await Task.findById(task.id))?.deletedAt).toBeInstanceOf(Date)
  })
})

describe('hallucinationGuard.guardCitations', () => {
  const a = 'aaaaaaaaaaaaaaaaaaaaaaaa' // 24 hex
  const b = 'bbbbbbbbbbbbbbbbbbbbbbbb'

  it('keeps citations that match the allowed list', () => {
    const out = guardCitations(`See [task:${a}]`, [{ kind: 'task', id: a }])
    expect(out.text).toBe(`See [task:${a}]`)
    expect(out.strippedCount).toBe(0)
  })

  it('strips uncited claims to "(unverified)"', () => {
    const out = guardCitations(`See [task:${b}]`, [{ kind: 'task', id: a }])
    expect(out.text).toBe('See (unverified)')
    expect(out.strippedCount).toBe(1)
  })

  it('handles mixed kinds', () => {
    const out = guardCitations(
      `Done [task:${a}] and [voice:${b}]`,
      [{ kind: 'task', id: a }],
    )
    expect(out.text).toBe(`Done [task:${a}] and (unverified)`)
  })
})
