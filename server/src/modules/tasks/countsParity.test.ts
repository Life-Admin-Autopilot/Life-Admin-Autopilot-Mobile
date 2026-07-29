import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../../models/Task'
import { Clarification } from '../../models/Clarification'
import { ScannedDocument } from '../../models/ScannedDocument'
import { buildDailyDigest } from './dailyDigest'
import { computeTaskCounts } from './taskCounts'

// The dashboard reads its counts from computeTaskCounts; the digest computes the
// same figures independently for its headline. Two implementations of one number
// is a drift waiting to happen, and this file is the tripwire.
//
// It is not hypothetical. Clarification.visibleOpen exists precisely because the
// dashboard once derived its "needs you" number from a 50-capped page while the
// digest aggregated the whole collection, so the two disagreed for anyone with a
// real backlog. Any figure both sides expose is asserted equal here.

// The digest reaches for a model to write its headline. Not the subject here —
// stub it off so these run without AI and without the background refresh.
vi.mock('../ai/provider/geminiClient', () => ({
  isAiConfigured: () => false,
  getGeminiClient: () => {
    throw new Error('not configured')
  },
  __resetGeminiClientForTests: () => {},
}))

const NOW = new Date('2026-07-27T12:00:00.000Z')
const TZ = 'UTC'
const DAY_MS = 86_400_000

let userId: string

beforeEach(() => {
  userId = new Types.ObjectId().toHexString()
})

function task(over: Record<string, unknown> = {}) {
  return Task.create({
    userId: new Types.ObjectId(userId),
    title: 'Pay electricity bill',
    domain: 'home',
    ...over,
  })
}

function clarification(over: Record<string, unknown> = {}) {
  return Clarification.create({
    userId: new Types.ObjectId(userId),
    taskId: new Types.ObjectId(),
    status: 'open',
    draft: { title: 'Car insurance', domain: 'car', priority: 'normal', tags: [] },
    question: 'The 15th or the 18th?',
    ...over,
  })
}

function scan(over: Record<string, unknown> = {}) {
  return ScannedDocument.create({
    userId: new Types.ObjectId(userId),
    storageKey: 'k',
    mimeType: 'application/pdf',
    pageCount: 1,
    byteSize: 10,
    clientCapturedAt: NOW,
    status: 'ready_for_review',
    ...over,
  })
}

describe('dashboard counts — parity between the fast source and the digest', () => {
  it('agrees on every shared figure for a populated account', async () => {
    await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T15:00:00.000Z') })
    await task({ title: 'Call plumber', dueAt: new Date('2026-07-30T09:00:00.000Z') })
    await task({
      title: 'Filed accounts',
      status: 'done',
      completedAt: new Date('2026-07-27T08:00:00.000Z'),
    })
    // Overdue by a month — past the fortnight cutoff, so it is slipping.
    await task({ title: 'Renew passport', dueAt: new Date(NOW.getTime() - 30 * DAY_MS) })
    await clarification()
    await scan()

    const [counts, digest] = await Promise.all([
      computeTaskCounts(userId, TZ, NOW),
      buildDailyDigest({ userId, timezone: TZ, now: NOW }),
    ])

    expect(counts.slipping).toBe(digest.counts.slipping)
    expect(counts.completedToday).toBe(digest.counts.completedToday)
    expect(counts.needsInput).toBe(digest.counts.needsInput)
    expect(counts.open).toBe(digest.counts.openTotal)
    // Sanity: parity on two zeros would prove nothing.
    expect(counts.slipping).toBe(1)
    expect(counts.completedToday).toBe(1)
    expect(counts.needsInput).toBe(1)
  })

  it('excludes a skipped question from needsInput', async () => {
    await clarification()
    // Deferred into the future — the user put this one down, so it is not
    // outstanding. visibleOpen() is what both sides must compose.
    await clarification({ deferredUntil: new Date(NOW.getTime() + DAY_MS) })

    const [counts, digest] = await Promise.all([
      computeTaskCounts(userId, TZ, NOW),
      buildDailyDigest({ userId, timezone: TZ, now: NOW }),
    ])

    expect(counts.needsInput).toBe(1)
    expect(counts.needsInput).toBe(digest.counts.needsInput)
  })

  it('excludes an already-reviewed scan from scansAwaitingReview', async () => {
    await scan()
    // `ready_for_review` is the terminal success state of scanning and is kept
    // forever, so it cannot be the signal on its own — `reviewedAt` is. The
    // digest's own fingerprint omits this guard, which is why the dashboard
    // filtered client-side before these counts moved server-side.
    await scan({ reviewedAt: NOW })

    const counts = await computeTaskCounts(userId, TZ, NOW)

    expect(counts.scansAwaitingReview).toBe(1)
  })
})
