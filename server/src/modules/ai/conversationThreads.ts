import { randomUUID } from 'node:crypto'

import { Types } from 'mongoose'

import {
  AI_CONVERSATION_TITLE_MAX,
  AiConversation,
  type AiConversationMessage,
} from '../../models/AiConversation'

// Thread lifecycle — list / create / rename / delete. Message persistence for
// one thread lives in conversationService.ts; this module owns the set of
// threads a user has.
//
// A thread IS the (userId, scope, scopeId) doc the store was always keyed by —
// multi-thread support did not add a dimension, it stopped pinning scopeId to
// null. That means no index migration: the unique compound index already
// enforces one doc per thread.
//
// The one wrinkle is the single thread every existing user already has, whose
// scopeId is null. `null` is a legitimate, addressable id in the store, but it
// cannot round-trip through a URL path segment — so listThreads() adopts it
// into a real id the first time it sees one. See adoptLegacyThread.

export interface ThreadSummary {
  id: string
  title: string | null
  /** First line of the last message, for the drawer's second row. */
  preview: string
  messageCount: number
  updatedAt: string
}

function userFilter(userId: string | Types.ObjectId): {
  userId: Types.ObjectId
  scope: 'personal'
} {
  return {
    userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    scope: 'personal',
  }
}

/** Collapse a message to a single line of at most `max` characters. */
export function summarizeText(text: string, max = AI_CONVERSATION_TITLE_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  // Prefer a word boundary so the ellipsis doesn't land mid-word. Only when
  // one exists reasonably deep — a long unbroken string just gets cut.
  const cut = flat.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`
}

function lastMessageOf(messages: AiConversationMessage[]): AiConversationMessage | undefined {
  return messages[messages.length - 1]
}

// Give the legacy scopeId:null doc a real id. Runs at most once per user: the
// filter requires scopeId to still be null, so a concurrent request either
// wins or matches nothing. Returns the id now on the doc.
async function adoptLegacyThread(
  userId: string | Types.ObjectId,
  candidateId: string,
): Promise<string> {
  const result = await AiConversation.updateOne(
    { ...userFilter(userId), scopeId: null },
    { $set: { scopeId: candidateId } },
  )
  if (result.modifiedCount > 0) return candidateId
  // Lost the race — the other request adopted it. Re-read to get their id.
  const doc = await AiConversation.findOne(
    { ...userFilter(userId), _id: { $exists: true } },
    { scopeId: 1 },
  ).sort({ updatedAt: -1 })
  return doc?.scopeId ?? candidateId
}

export async function listThreads(userId: string | Types.ObjectId): Promise<ThreadSummary[]> {
  const docs = await AiConversation.find(userFilter(userId)).sort({ updatedAt: -1 })

  const summaries: ThreadSummary[] = []
  for (const doc of docs) {
    const id = doc.scopeId ?? (await adoptLegacyThread(userId, randomUUID()))
    const last = lastMessageOf(doc.messages)
    summaries.push({
      id,
      title: doc.title ?? null,
      preview: last ? summarizeText(last.text, 120) : '',
      messageCount: doc.messages.length,
      updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString() ?? new Date(0).toISOString(),
    })
  }
  return summaries
}

export async function createThread(
  userId: string | Types.ObjectId,
  title?: string | null,
): Promise<ThreadSummary> {
  const id = randomUUID()
  const doc = await AiConversation.create({
    ...userFilter(userId),
    scopeId: id,
    title: title ? summarizeText(title) : null,
    messages: [],
  })
  return {
    id,
    title: doc.title ?? null,
    preview: '',
    messageCount: 0,
    updatedAt: (doc as unknown as { updatedAt?: Date }).updatedAt?.toISOString() ?? new Date().toISOString(),
  }
}

/** True when the thread exists and belongs to this user. */
export async function threadExists(
  userId: string | Types.ObjectId,
  conversationId: string,
): Promise<boolean> {
  const count = await AiConversation.countDocuments({
    ...userFilter(userId),
    scopeId: conversationId,
  }).limit(1)
  return count > 0
}

/**
 * Resolve which thread a turn belongs to, creating one if the user has none.
 *
 * A client that names a thread it does not own gets a fresh one rather than an
 * error: the id is opaque to the user, so the only ways to get here are a
 * deleted thread racing an in-flight send or a stale cache — and dropping the
 * user's sentence on the floor is a worse answer than filing it somewhere.
 */
export async function resolveThreadId(
  userId: string | Types.ObjectId,
  requested?: string | null,
): Promise<string> {
  if (requested && (await threadExists(userId, requested))) return requested

  const existing = await listThreads(userId)
  const mostRecent = existing[0]
  if (mostRecent) return mostRecent.id

  const created = await createThread(userId)
  return created.id
}

export async function renameThread(
  userId: string | Types.ObjectId,
  conversationId: string,
  title: string,
): Promise<boolean> {
  const result = await AiConversation.updateOne(
    { ...userFilter(userId), scopeId: conversationId },
    { $set: { title: summarizeText(title) } },
  )
  return result.matchedCount > 0
}

export async function deleteThread(
  userId: string | Types.ObjectId,
  conversationId: string,
): Promise<boolean> {
  const result = await AiConversation.deleteOne({
    ...userFilter(userId),
    scopeId: conversationId,
  })
  return result.deletedCount > 0
}

/**
 * Title a thread from its first user message.
 *
 * Deliberately NOT a model call: a title is a label, and spending a Gemini
 * round (and a slice of the user's daily quota) on one would be paying real
 * money for a summary of a sentence the user can already see. The filter
 * requires the title to still be unset, so later turns leave it alone and a
 * user's own rename is never overwritten.
 */
export async function titleThreadFromFirstMessage(
  userId: string | Types.ObjectId,
  conversationId: string,
  text: string,
): Promise<void> {
  const title = summarizeText(text)
  if (title.length === 0) return
  await AiConversation.updateOne(
    {
      ...userFilter(userId),
      scopeId: conversationId,
      $or: [{ title: null }, { title: { $exists: false } }],
    },
    { $set: { title } },
  )
}
