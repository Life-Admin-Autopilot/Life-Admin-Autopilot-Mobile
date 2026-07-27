import { Types } from 'mongoose'

import {
  AI_CONVERSATION_MAX_TURNS,
  AiConversation,
  type AiConversationDoc,
  type AiConversationMessage,
  type AiConversationScope,
  type AiConversationSource,
  type AiConversationToolCall,
} from '../../models/AiConversation'

// Conversation persistence — one doc per (userId, scope, scopeId). Always
// upserts so the caller never has to branch on "first time" vs "returning".
// Trimming to AI_CONVERSATION_MAX_TURNS happens on every push via $slice
// so the doc stays bounded under heavy use. Mirrors Wiscord's pattern.

export interface ConversationKey {
  userId: string | Types.ObjectId
  scope: AiConversationScope
  scopeId?: string | null
}

function keyFilter(key: ConversationKey): {
  userId: Types.ObjectId
  scope: AiConversationScope
  scopeId: string | null
} {
  return {
    userId: typeof key.userId === 'string' ? new Types.ObjectId(key.userId) : key.userId,
    scope: key.scope,
    scopeId: key.scopeId ?? null,
  }
}

export async function loadConversation(key: ConversationKey): Promise<AiConversationDoc> {
  const filter = keyFilter(key)
  const existing = await AiConversation.findOne(filter)
  if (existing) return existing
  return AiConversation.create({ ...filter, messages: [] })
}

export async function resetConversation(key: ConversationKey): Promise<void> {
  await AiConversation.updateOne(keyFilter(key), { $set: { messages: [] } }, { upsert: true })
}

interface AppendArgs extends ConversationKey {
  role: 'user' | 'assistant'
  text: string
  sources?: AiConversationSource[]
  toolCalls?: AiConversationToolCall[]
}

export async function appendTurn(args: AppendArgs): Promise<void> {
  const message: AiConversationMessage = {
    role: args.role,
    text: args.text,
    createdAt: new Date(),
    ...(args.sources && args.sources.length > 0 ? { sources: args.sources } : {}),
    ...(args.toolCalls && args.toolCalls.length > 0 ? { toolCalls: args.toolCalls } : {}),
  }
  await AiConversation.updateOne(
    keyFilter(args),
    {
      $push: { messages: { $each: [message], $slice: -AI_CONVERSATION_MAX_TURNS } },
    },
    { upsert: true },
  )
}

// Return the last N turns. Capped at the doc's own MAX so a future bug
// can't ask for an unbounded slice.
export async function recentTurns(
  key: ConversationKey,
  n = 10,
): Promise<AiConversationMessage[]> {
  const cappedN = Math.max(1, Math.min(n, AI_CONVERSATION_MAX_TURNS))
  const doc = await AiConversation.findOne(keyFilter(key), {
    messages: { $slice: -cappedN },
  })
  return doc?.messages ?? []
}

// Flip every pending_confirmation tool call older than maxAgeMs to declined.
// Prevents stale pending calls from leaving unpaired functionCall parts in
// the multi-turn history we ship to Gemini — Gemini 3 returns a protocol
// error when a functionCall has no matching functionResponse.
//
// Returns the number of tool calls flipped. Idempotent — calling twice in
// a row makes no further change because the status is no longer
// pending_confirmation after the first sweep.
export async function expireStalePendingToolCalls(
  key: ConversationKey,
  maxAgeMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs)
  const filter = {
    ...keyFilter(key),
    messages: {
      $elemMatch: {
        createdAt: { $lt: cutoff },
        toolCalls: { $elemMatch: { status: 'pending_confirmation' } },
      },
    },
  }
  const result = await AiConversation.updateOne(
    filter,
    { $set: { 'messages.$[msg].toolCalls.$[call].status': 'declined' } },
    {
      arrayFilters: [
        { 'msg.createdAt': { $lt: cutoff }, 'msg.toolCalls': { $type: 'array' } },
        { 'call.status': 'pending_confirmation' },
      ],
    },
  )
  return result.modifiedCount
}

// Resolve a single pending tool call in-place: flip its status and write
// back the result or error. Used by the confirm route so the next turn's
// history correctly emits the functionCall + functionResponse pair to
// Gemini.
export async function resolveToolCall(args: {
  key: ConversationKey
  callId: string
  status: 'executed' | 'failed' | 'declined'
  result?: Record<string, unknown> | null
  error?: string | null
}): Promise<number> {
  const setOps: Record<string, unknown> = {
    'messages.$[msg].toolCalls.$[call].status': args.status,
  }
  if (args.result !== undefined) {
    setOps['messages.$[msg].toolCalls.$[call].result'] = args.result
  }
  if (args.error !== undefined) {
    setOps['messages.$[msg].toolCalls.$[call].error'] = args.error
  }
  const filter = {
    ...keyFilter(args.key),
    messages: {
      $elemMatch: { toolCalls: { $elemMatch: { callId: args.callId } } },
    },
  }
  const updateResult = await AiConversation.updateOne(filter, { $set: setOps }, {
    arrayFilters: [
      { 'msg.toolCalls.callId': args.callId },
      { 'call.callId': args.callId },
    ],
  })
  return updateResult.modifiedCount
}

// Look up a pending tool call (callId + name + args) without mutating it.
// Used by the confirm route to re-validate args server-side after the user
// confirms — defense-in-depth: the frontend never gets to skip the validator.
export async function findPendingToolCall(args: {
  key: ConversationKey
  callId: string
}): Promise<AiConversationToolCall | null> {
  const doc = await AiConversation.findOne({
    ...keyFilter(args.key),
    messages: {
      $elemMatch: { toolCalls: { $elemMatch: { callId: args.callId } } },
    },
  })
  if (!doc) return null
  for (const message of doc.messages) {
    if (!message.toolCalls) continue
    const call = message.toolCalls.find((c) => c.callId === args.callId)
    if (call) return call
  }
  return null
}
