import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { auth, request, signUp } from '../../test/helpers'
import { AiConversation, AI_CONVERSATION_MAX_TURNS } from '../../models/AiConversation'
import {
  appendTurn,
  expireStalePendingToolCalls,
  findPendingToolCall,
  loadConversation,
  recentTurns,
  resetConversation,
  resolveToolCall,
} from './conversationService'

describe('conversationService', () => {
  it('loads or creates a conversation per (userId, scope, scopeId)', async () => {
    const userId = new Types.ObjectId().toHexString()
    const conv = await loadConversation({ userId, scope: 'personal' })
    expect(conv.userId.toString()).toBe(userId)
    expect(conv.messages).toEqual([])

    const again = await loadConversation({ userId, scope: 'personal' })
    expect(again._id.toString()).toBe(conv._id.toString())
  })

  it('appendTurn enforces the slice cap', async () => {
    const userId = new Types.ObjectId().toHexString()
    for (let i = 0; i < AI_CONVERSATION_MAX_TURNS + 5; i++) {
      await appendTurn({
        userId,
        scope: 'personal',
        role: 'user',
        text: `turn ${i}`,
      })
    }
    const turns = await recentTurns({ userId, scope: 'personal' }, AI_CONVERSATION_MAX_TURNS)
    expect(turns).toHaveLength(AI_CONVERSATION_MAX_TURNS)
    expect(turns[0]?.text).toBe('turn 5')
  })

  it('resetConversation wipes messages but keeps the doc', async () => {
    const userId = new Types.ObjectId().toHexString()
    await appendTurn({ userId, scope: 'personal', role: 'user', text: 'hello' })
    await resetConversation({ userId, scope: 'personal' })
    const after = await AiConversation.findOne({ userId: new Types.ObjectId(userId) })
    expect(after?.messages).toEqual([])
  })

  it('resolveToolCall flips status and writes back result', async () => {
    const userId = new Types.ObjectId().toHexString()
    await appendTurn({
      userId,
      scope: 'personal',
      role: 'assistant',
      text: '',
      toolCalls: [
        {
          callId: 'c1',
          name: 'updateTask',
          args: { taskId: 'abc' },
          status: 'pending_confirmation',
        },
      ],
    })
    const modified = await resolveToolCall({
      key: { userId, scope: 'personal' },
      callId: 'c1',
      status: 'executed',
      result: { ok: true },
    })
    expect(modified).toBe(1)
    const call = await findPendingToolCall({
      key: { userId, scope: 'personal' },
      callId: 'c1',
    })
    expect(call?.status).toBe('executed')
    expect(call?.result).toEqual({ ok: true })
  })

  it('expireStalePendingToolCalls flips old pending calls to declined', async () => {
    const userId = new Types.ObjectId().toHexString()
    // Manually insert a message with an old createdAt so the sweep flips it.
    const old = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
    await AiConversation.create({
      userId: new Types.ObjectId(userId),
      scope: 'personal',
      scopeId: null,
      messages: [
        {
          role: 'assistant',
          text: '',
          createdAt: old,
          toolCalls: [
            {
              callId: 'stale',
              name: 'deleteTask',
              args: { taskId: 'x' },
              status: 'pending_confirmation',
            },
          ],
        },
      ],
    })

    const flipped = await expireStalePendingToolCalls(
      { userId, scope: 'personal' },
      30 * 60 * 1000, // 30m
    )
    expect(flipped).toBe(1)
    const call = await findPendingToolCall({
      key: { userId, scope: 'personal' },
      callId: 'stale',
    })
    expect(call?.status).toBe('declined')

    // Idempotent — second sweep flips nothing.
    const flippedAgain = await expireStalePendingToolCalls(
      { userId, scope: 'personal' },
      30 * 60 * 1000,
    )
    expect(flippedAgain).toBe(0)
  })

  it('expireStalePendingToolCalls is a no-op when nothing is stale', async () => {
    const userId = new Types.ObjectId().toHexString()
    await appendTurn({
      userId,
      scope: 'personal',
      role: 'user',
      text: 'just text, no tool calls',
    })
    const flipped = await expireStalePendingToolCalls(
      { userId, scope: 'personal' },
      30 * 60 * 1000,
    )
    expect(flipped).toBe(0)
  })
})

describe('GET /ai/conversation', () => {
  it('returns an empty conversation for a fresh user', async () => {
    const session = await signUp()
    const res = await request
      .get('/ai/conversation')
      .set('Authorization', auth(session.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.scope).toBe('personal')
    expect(res.body.messages).toEqual([])
  })

  it('rejects unauthenticated requests', async () => {
    const res = await request.get('/ai/conversation')
    expect(res.status).toBe(401)
  })
})

describe('POST /ai/conversation/reset', () => {
  it('wipes messages and returns 200', async () => {
    const session = await signUp()
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      role: 'user',
      text: 'hello',
    })

    const res = await request
      .post('/ai/conversation/reset')
      .set('Authorization', auth(session.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.messages).toEqual([])

    const get = await request
      .get('/ai/conversation')
      .set('Authorization', auth(session.accessToken))
    expect(get.body.messages).toEqual([])
  })
})
