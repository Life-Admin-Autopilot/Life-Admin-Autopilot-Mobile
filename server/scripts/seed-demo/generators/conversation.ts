import { Types } from 'mongoose'

import { AI_CONVERSATION_MAX_TURNS } from '../../../src/models/AiConversation'
import { CHAT_ASSISTANT_TURNS, CHAT_USER_TURNS } from '../catalog/phrasing'
import { VOLUMES } from '../config'
import { addDays, atTime, startOfDay } from '../calendar'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'
import type { TaskSeed } from './taskFactory'

// The chat thread, so opening the island lands on a history rather than a
// blank slate.
//
// One doc per (userId, scope, scopeId) — the model's unique index — and capped
// at AI_CONVERSATION_MAX_TURNS, which the $slice on every real $push enforces.
// Seeding past the cap would produce a document the app itself could never
// have written.

const TOOL_CALLS: { name: string; args: Record<string, unknown> }[] = [
  { name: 'createTask', args: { title: 'Pay the water bill', domain: 'finance', kind: 'reminder' } },
  { name: 'searchTasks', args: { query: 'school' } },
  { name: 'completeTasks', args: { scope: 'yesterday' } },
  { name: 'rescheduleTask', args: { to: 'next Tuesday' } },
  { name: 'summarizeRange', args: { range: 'last month' } },
]

export function buildConversation(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  tasks: TaskSeed[]
}): SeedDoc {
  const { rng, userId, now, tasks } = args
  const turns = Math.min(VOLUMES.conversationTurns, AI_CONVERSATION_MAX_TURNS)
  const pairs = Math.floor(turns / 2)
  const linkable = rng.shuffle(tasks.filter((t) => !t.deletedAt)).slice(0, pairs)

  const messages: Record<string, unknown>[] = []
  // Walk backwards from today so the newest exchange is the one on screen.
  let at = atTime(startOfDay(now), 20)

  for (let i = pairs - 1; i >= 0; i -= 1) {
    at = atTime(addDays(at, -rng.int(0, 2)), rng.int(8, 22))
    const askedAt = new Date(at.getTime())
    const answeredAt = new Date(askedAt.getTime() + rng.int(1_200, 4_500))

    messages.unshift({
      role: 'assistant',
      text: CHAT_ASSISTANT_TURNS[i % CHAT_ASSISTANT_TURNS.length]!,
      sources: linkable[i]
        ? [{ kind: 'task', id: String(linkable[i]!._id), title: linkable[i]!.title }]
        : undefined,
      toolCalls: rng.chance(0.35)
        ? [
            {
              callId: new Types.ObjectId().toHexString(),
              name: rng.pick(TOOL_CALLS).name,
              args: rng.pick(TOOL_CALLS).args,
              status: 'executed',
              result: { ok: true },
              error: null,
            },
          ]
        : undefined,
      createdAt: answeredAt,
    })
    messages.unshift({
      role: 'user',
      text: CHAT_USER_TURNS[i % CHAT_USER_TURNS.length]!,
      createdAt: askedAt,
    })
  }

  const first = messages[0]?.createdAt as Date | undefined

  return {
    _id: new Types.ObjectId(),
    userId,
    scope: 'personal',
    scopeId: null,
    messages,
    createdAt: first ?? now,
    updatedAt: now,
  }
}
