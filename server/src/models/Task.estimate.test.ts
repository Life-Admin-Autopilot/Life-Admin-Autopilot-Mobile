import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import {
  ESTIMATE_BUCKETS,
  Task,
  normalizeEstimate,
  snapToEstimateBucket,
  type TaskEstimate,
} from './Task'

// The estimate exists to be honest about imprecision. These tests are mostly
// about what the system REFUSES to record: a value off the ladder, a range that
// runs backwards, and — above all — an AI overwriting a number the user set.

describe('snapToEstimateBucket', () => {
  it('leaves a value that is already a bucket alone', () => {
    for (const bucket of ESTIMATE_BUCKETS) {
      expect(snapToEstimateBucket(bucket)).toBe(bucket)
    }
  })

  it('snaps an off-ladder value to the nearest bucket', () => {
    // The case the whole design exists for: "23 minutes" is a precision claim
    // nobody can back, so it becomes the nearest thing anyone can mean by it.
    expect(snapToEstimateBucket(23)).toBe(30)
    expect(snapToEstimateBucket(18)).toBe(15)
    expect(snapToEstimateBucket(7)).toBe(5)
    expect(snapToEstimateBucket(100)).toBe(90)
    expect(snapToEstimateBucket(200)).toBe(180)
  })

  it('rounds a tie up, because people underestimate admin', () => {
    expect(snapToEstimateBucket(7.5)).toBe(10)
    expect(snapToEstimateBucket(22.5)).toBe(30)
  })

  it('clamps below the floor and above the ceiling', () => {
    expect(snapToEstimateBucket(0)).toBe(5)
    expect(snapToEstimateBucket(-30)).toBe(5)
    expect(snapToEstimateBucket(1_000)).toBe(240)
  })

  it('handles the non-finite edges without landing off the ladder', () => {
    expect(snapToEstimateBucket(Number.NaN)).toBe(5)
    expect(snapToEstimateBucket(Number.POSITIVE_INFINITY)).toBe(240)
    expect(snapToEstimateBucket(Number.NEGATIVE_INFINITY)).toBe(5)
  })
})

describe('normalizeEstimate', () => {
  it('snaps both bounds and stamps the source', () => {
    expect(normalizeEstimate({ minMinutes: 18, maxMinutes: 47 }, 'ai')).toEqual({
      minMinutes: 15,
      maxMinutes: 45,
      source: 'ai',
    })
  })

  it('parses the string labels the AI response schemas ask for', () => {
    expect(normalizeEstimate({ minMinutes: '30', maxMinutes: '60' }, 'ai')).toEqual({
      minMinutes: 30,
      maxMinutes: 60,
      source: 'ai',
    })
  })

  it('orders a reversed range rather than rejecting it', () => {
    const estimate = normalizeEstimate({ minMinutes: 120, maxMinutes: 15 }, 'ai')
    expect(estimate).toEqual({ minMinutes: 15, maxMinutes: 120, source: 'ai' })
  })

  it('guarantees maxMinutes >= minMinutes across a spread of inputs', () => {
    const pairs: [number, number][] = [
      [5, 5],
      [23, 47],
      [240, 1],
      [-10, 9_999],
      [90, 90],
    ]
    for (const [min, max] of pairs) {
      const estimate = normalizeEstimate({ minMinutes: min, maxMinutes: max }, 'ai')
      expect(estimate).toBeDefined()
      const { minMinutes, maxMinutes } = estimate as TaskEstimate
      expect(maxMinutes).toBeGreaterThanOrEqual(minMinutes)
      expect(ESTIMATE_BUCKETS).toContain(minMinutes)
      expect(ESTIMATE_BUCKETS).toContain(maxMinutes)
    }
  })

  it('treats a single bound as a point estimate', () => {
    expect(normalizeEstimate({ minMinutes: 30 }, 'ai')).toEqual({
      minMinutes: 30,
      maxMinutes: 30,
      source: 'ai',
    })
    expect(normalizeEstimate({ maxMinutes: 30 }, 'user')).toEqual({
      minMinutes: 30,
      maxMinutes: 30,
      source: 'user',
    })
  })

  it('returns undefined when there is nothing usable to snap', () => {
    expect(normalizeEstimate(undefined, 'ai')).toBeUndefined()
    expect(normalizeEstimate(null, 'ai')).toBeUndefined()
    expect(normalizeEstimate({}, 'ai')).toBeUndefined()
    expect(normalizeEstimate({ minMinutes: 'soon', maxMinutes: null }, 'ai')).toBeUndefined()
  })
})

describe('Task.estimate persistence', () => {
  const base = {
    userId: new Types.ObjectId(),
    title: 'Renew car insurance',
    domain: 'car' as const,
  }

  it('round-trips through toJSON alongside the derived priorityRank', async () => {
    const task = await Task.create({
      ...base,
      estimate: { minMinutes: 15, maxMinutes: 30, source: 'ai' },
    })
    const json = task.toJSON() as Record<string, unknown>

    expect(json.estimate).toEqual({ minMinutes: 15, maxMinutes: 30, source: 'ai' })
    // The subdocument must not leak Mongo internals into the client payload.
    expect(json.estimate).not.toHaveProperty('_id')
    expect(json.priorityRank).toBe(1)
  })

  it('serializes without an estimate for a task that has none', async () => {
    const task = await Task.create(base)
    expect((task.toJSON() as Record<string, unknown>).estimate).toBeUndefined()
  })

  it('rejects a value that is not on the ladder', async () => {
    await expect(
      Task.create({ ...base, estimate: { minMinutes: 23, maxMinutes: 30, source: 'ai' } }),
    ).rejects.toThrow()
  })

  it('rejects a range that runs backwards', async () => {
    await expect(
      Task.create({ ...base, estimate: { minMinutes: 120, maxMinutes: 30, source: 'ai' } }),
    ).rejects.toThrow()
  })

  it('rejects an unknown source', async () => {
    await expect(
      Task.create({ ...base, estimate: { minMinutes: 15, maxMinutes: 30, source: 'guess' } }),
    ).rejects.toThrow()
  })
})
