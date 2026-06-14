import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { AppError } from '../../lib/errors'
import { AiUsageCounter, utcDateBucket } from '../../models/AiUsageCounter'
import { admitWithinQuota, getQuotaStatus, recordUsage, releaseUsageSlot } from './quota'

// The free-tier daily quota. The env default is 30 (env.ts AI_QUOTA_FREE_DAILY)
// and the test harness doesn't override it, so we drive the counter directly to
// the limit instead of hammering admit 30x. A fresh ObjectId per test keeps
// rows isolated within the shared in-memory db.
function freshUser(): string {
  return new Types.ObjectId().toHexString()
}

describe('admitWithinQuota — atomic admission', () => {
  it('admits and increments the counter from zero', async () => {
    const userId = freshUser()
    const today = utcDateBucket()

    await admitWithinQuota({ userId, tier: 'free', kind: 'message', today })

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(1)
  })

  it('admits repeatedly up to the limit, then throws 402 with details at the limit', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const limit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit
    expect(limit).toBeGreaterThan(0)

    // Pre-fill the counter to one-below the limit so the next admit is the last
    // legal slot, and the one after must be refused.
    await AiUsageCounter.create({
      userId: new Types.ObjectId(userId),
      date: today,
      kind: 'message',
      count: limit - 1,
    })

    // The final legal slot is admitted.
    await admitWithinQuota({ userId, tier: 'free', kind: 'message', today })
    const atLimit = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(atLimit?.count).toBe(limit)

    // Now AT the limit: the next admission throws a 402 with the upgrade-prompt
    // details payload.
    let thrown: unknown
    try {
      await admitWithinQuota({ userId, tier: 'free', kind: 'message', today })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(AppError)
    const appErr = thrown as AppError
    expect(appErr.status).toBe(402)
    expect(appErr.code).toBe('quota_exceeded')
    expect(appErr.details).toMatchObject({
      kind: 'message',
      tier: 'free',
      limit,
      used: limit,
    })
    expect((appErr.details as { resetAt: string }).resetAt).toMatch(/Z$/)

    // The over-limit attempt did NOT bump the counter past the limit.
    const after = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(after?.count).toBe(limit)
  })

  it('admits on the pro tier against the higher pro limit', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const freeLimit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit
    const proLimit = (await getQuotaStatus({ userId, tier: 'pro', today }))[0]!.limit
    expect(proLimit).toBeGreaterThan(freeLimit)

    // Seed AT the free limit. A free-tier admit would be refused here, but a
    // pro-tier admit has headroom and must succeed.
    await AiUsageCounter.create({
      userId: new Types.ObjectId(userId),
      date: today,
      kind: 'message',
      count: freeLimit,
    })
    await admitWithinQuota({ userId, tier: 'pro', kind: 'message', today })

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(freeLimit + 1)
  })
})

describe('admitWithinQuota — concurrent admission is atomic', () => {
  it('rejects the over-limit caller when N+1 requests race for N free slots', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const limit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit

    // Seed to one-below the limit so exactly ONE slot is free. Fire TWO admits
    // concurrently: the atomic conditional write must let exactly one through.
    await AiUsageCounter.create({
      userId: new Types.ObjectId(userId),
      date: today,
      kind: 'message',
      count: limit - 1,
    })

    const results = await Promise.allSettled([
      admitWithinQuota({ userId, tier: 'free', kind: 'message', today }),
      admitWithinQuota({ userId, tier: 'free', kind: 'message', today }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The rejection is a 402, and the counter never exceeds the limit.
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(reason).toBeInstanceOf(AppError)
    expect((reason as AppError).status).toBe(402)

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(limit)
  })

  it('admits exactly the limit when many requests race from empty', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const limit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit

    // Fire limit + 5 admits concurrently from an empty counter. Exactly `limit`
    // must succeed; the rest get 402. The duplicate-key retry path is exercised
    // here because multiple racing upserts hit the unique index.
    const attempts = Array.from({ length: limit + 5 }, () =>
      admitWithinQuota({ userId, tier: 'free', kind: 'message', today }),
    )
    const results = await Promise.allSettled(attempts)
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length
    const rejected = results.filter((r) => r.status === 'rejected').length

    expect(fulfilled).toBe(limit)
    expect(rejected).toBe(5)

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(limit)
  })
})

describe('releaseUsageSlot — refund on aborted turn', () => {
  it('decrements a previously-admitted slot', async () => {
    const userId = freshUser()
    const today = utcDateBucket()

    await admitWithinQuota({ userId, tier: 'free', kind: 'message', today })
    await releaseUsageSlot({ userId, kind: 'message', today })

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(0)
  })

  it('never drives the counter below zero', async () => {
    const userId = freshUser()
    const today = utcDateBucket()

    // No admit first — release on a zero/absent counter is a safe no-op.
    await releaseUsageSlot({ userId, kind: 'message', today })
    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    // Either the row never existed, or it sits at 0 — never negative.
    expect(row?.count ?? 0).toBe(0)
  })
})

describe('recordUsage — ungated continuation counting', () => {
  it('increments without a limit guard (continuation is the same paid turn)', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const limit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit

    // Seed AT the limit, then record one more. recordUsage must NOT refuse it.
    await AiUsageCounter.create({
      userId: new Types.ObjectId(userId),
      date: today,
      kind: 'message',
      count: limit,
    })
    await recordUsage({ userId, kind: 'message', today })

    const row = await AiUsageCounter.findOne({ userId, date: today, kind: 'message' }).lean()
    expect(row?.count).toBe(limit + 1)
  })
})

describe('getQuotaStatus — derived view', () => {
  it('reports remaining = limit - used clamped at zero', async () => {
    const userId = freshUser()
    const today = utcDateBucket()
    const limit = (await getQuotaStatus({ userId, tier: 'free', today }))[0]!.limit

    await AiUsageCounter.create({
      userId: new Types.ObjectId(userId),
      date: today,
      kind: 'message',
      count: limit + 3, // over the limit (e.g. after an ungated continuation)
    })

    const status = await getQuotaStatus({ userId, tier: 'free', today })
    const message = status.find((s) => s.kind === 'message')!
    expect(message.used).toBe(limit + 3)
    expect(message.remaining).toBe(0) // clamped, never negative
    expect(message.resetAt).toMatch(/Z$/)
  })
})
