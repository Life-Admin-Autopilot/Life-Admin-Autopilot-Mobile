import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { AiConversation } from '../../models/AiConversation'
import { appendTurn } from './conversationService'
import {
  createThread,
  deleteThread,
  listThreads,
  renameThread,
  resolveThreadId,
  summarizeText,
  threadExists,
  titleThreadFromFirstMessage,
} from './conversationThreads'

describe('conversationThreads', () => {
  it('lists threads most recently active first', async () => {
    const userId = new Types.ObjectId().toHexString()
    const first = await createThread(userId)
    const second = await createThread(userId)

    // Touch the older thread — it should overtake the newer one.
    await appendTurn({
      userId,
      scope: 'personal',
      scopeId: first.id,
      role: 'user',
      text: 'renew the car insurance',
    })

    const threads = await listThreads(userId)
    expect(threads.map((t) => t.id)).toEqual([first.id, second.id])
    expect(threads[0]?.preview).toBe('renew the car insurance')
    expect(threads[0]?.messageCount).toBe(1)
  })

  it('adopts a legacy null-scopeId thread into an addressable id', async () => {
    const userId = new Types.ObjectId().toHexString()
    // Exactly the shape every pre-threads user already has in the collection.
    await AiConversation.create({
      userId: new Types.ObjectId(userId),
      scope: 'personal',
      scopeId: null,
      messages: [{ role: 'user', text: 'hello', createdAt: new Date() }],
    })

    const [thread] = await listThreads(userId)
    expect(thread?.id).toBeTruthy()
    expect(thread?.messageCount).toBe(1)

    // The transcript rode along — adoption renames the key, it does not fork
    // a new empty thread and strand the history.
    const stored = await AiConversation.findOne({ userId: new Types.ObjectId(userId) })
    expect(stored?.scopeId).toBe(thread?.id)
    expect(stored?.messages).toHaveLength(1)

    // Idempotent: a second list does not adopt again or duplicate the thread.
    const again = await listThreads(userId)
    expect(again).toHaveLength(1)
    expect(again[0]?.id).toBe(thread?.id)
  })

  it('resolveThreadId honours a known id, falls back to most recent, else creates', async () => {
    const userId = new Types.ObjectId().toHexString()

    // No threads at all — one gets created rather than erroring.
    const created = await resolveThreadId(userId)
    expect(await threadExists(userId, created)).toBe(true)

    const explicit = await createThread(userId)
    expect(await resolveThreadId(userId, explicit.id)).toBe(explicit.id)

    // An id the user does not own resolves to their own most recent thread —
    // never to the stranger's thread, and never to a dropped message.
    const resolved = await resolveThreadId(userId, 'not-a-thread-of-theirs')
    expect([created, explicit.id]).toContain(resolved)
  })

  it('titles a thread from its first message only, and never over a rename', async () => {
    const userId = new Types.ObjectId().toHexString()
    const thread = await createThread(userId)

    await titleThreadFromFirstMessage(userId, thread.id, 'book the dentist for next week')
    await titleThreadFromFirstMessage(userId, thread.id, 'something completely different')

    let [listed] = await listThreads(userId)
    expect(listed?.title).toBe('book the dentist for next week')

    await renameThread(userId, thread.id, 'Dentist')
    await titleThreadFromFirstMessage(userId, thread.id, 'yet another message')
    ;[listed] = await listThreads(userId)
    expect(listed?.title).toBe('Dentist')
  })

  it('deletes a thread and reports a miss', async () => {
    const userId = new Types.ObjectId().toHexString()
    const thread = await createThread(userId)

    expect(await deleteThread(userId, thread.id)).toBe(true)
    expect(await threadExists(userId, thread.id)).toBe(false)
    expect(await deleteThread(userId, thread.id)).toBe(false)
  })

  it('scopes every operation to the owning user', async () => {
    const owner = new Types.ObjectId().toHexString()
    const stranger = new Types.ObjectId().toHexString()
    const thread = await createThread(owner)

    expect(await threadExists(stranger, thread.id)).toBe(false)
    expect(await deleteThread(stranger, thread.id)).toBe(false)
    expect(await renameThread(stranger, thread.id, 'mine now')).toBe(false)
    expect(await listThreads(stranger)).toHaveLength(0)
    // Still intact for its owner.
    expect(await threadExists(owner, thread.id)).toBe(true)
  })

  it('summarizeText collapses whitespace and truncates on a word boundary', () => {
    expect(summarizeText('  renew   the\ncar insurance ')).toBe('renew the car insurance')
    const long = 'renew the car insurance before the policy lapses at the end of the month please'
    const short = summarizeText(long, 30)
    expect(short.length).toBeLessThanOrEqual(30)
    expect(short.endsWith('…')).toBe(true)
    expect(short).not.toContain('  ')
    // An unbroken run has no boundary to prefer — it just gets cut.
    expect(summarizeText('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})
