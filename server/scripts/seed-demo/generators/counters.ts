import { Types } from 'mongoose'

import { utcDateBucket } from '../../../src/models/AiUsageCounter'
import { utcMonthBucket } from '../../../src/models/DocumentScanUsageCounter'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'

// Quota counters, kept consistent with the volume that was actually seeded.
//
// These are inserted rather than skipped because the alternative is an app
// that looks heavily used while reporting nothing used — the billing and
// quota surfaces would show a fresh account sitting on three years of data.

const DAY_MS = 86_400_000

export function buildCounters(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  /** Scans whose clientCapturedAt falls in the current UTC month. */
  scansThisMonth: number
}): { ai: SeedDoc[]; scans: SeedDoc[] } {
  const { rng, userId, now, scansThisMonth } = args

  // A daily row for the last month of chat use. Older buckets are pointless:
  // the quota check only ever reads today's.
  const ai: SeedDoc[] = []
  for (let back = 0; back < 30; back += 1) {
    const day = new Date(now.getTime() - back * DAY_MS)
    const count = rng.weighted([
      [0, 12],
      [rng.int(1, 4), 45],
      [rng.int(5, 12), 33],
      [rng.int(13, 24), 10],
    ] as const)
    if (count === 0) continue
    ai.push({
      _id: new Types.ObjectId(),
      userId,
      date: utcDateBucket(day),
      kind: 'message',
      count,
      createdAt: day,
      updatedAt: day,
    })
  }

  const scans: SeedDoc[] = [
    {
      _id: new Types.ObjectId(),
      userId,
      month: utcMonthBucket(now),
      count: scansThisMonth,
      createdAt: now,
      updatedAt: now,
    },
  ]

  return { ai, scans }
}
