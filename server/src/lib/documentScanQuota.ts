import { env } from '../env'
import { AppError } from './errors'
import {
  DocumentScanUsageCounter,
  utcMonthBucket,
} from '../models/DocumentScanUsageCounter'
import type { SubscriptionTier } from '../models/User'

// Same atomic-admission shape as modules/ai/quota.ts's admitWithinQuota — a
// single conditional updateOne closes the check-then-increment TOCTOU race.
// Monthly (not daily) bucket: this guards sustained cost, not bursts (the
// per-user rate limiter already guards bursts).

function quotaFor(tier: SubscriptionTier): number {
  return tier === 'pro' ? env().DOCUMENT_SCAN_QUOTA_PRO_MONTHLY : env().DOCUMENT_SCAN_QUOTA_FREE_MONTHLY
}

function quotaExceeded(args: { tier: SubscriptionTier; limit: number; used: number }): AppError {
  return new AppError(
    402,
    'document_scan_quota_exceeded',
    `You've hit this month's limit of ${args.limit} document scans.`,
    { tier: args.tier, limit: args.limit, used: args.used },
  )
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  )
}

export async function admitDocumentScan(args: {
  userId: string
  tier: SubscriptionTier
  month?: string
}): Promise<void> {
  const month = args.month ?? utcMonthBucket()
  const limit = quotaFor(args.tier)

  const filter = { userId: args.userId, month, count: { $lt: limit } }

  try {
    const res = await DocumentScanUsageCounter.updateOne(
      filter,
      { $inc: { count: 1 } },
      { upsert: true },
    )
    if (res.modifiedCount > 0 || res.upsertedCount > 0) return
  } catch (err: unknown) {
    if (!isDuplicateKeyError(err)) throw err
    const retry = await DocumentScanUsageCounter.updateOne(filter, { $inc: { count: 1 } })
    if (retry.modifiedCount > 0) return
  }

  const row = await DocumentScanUsageCounter.findOne({ userId: args.userId, month }).lean()
  throw quotaExceeded({ tier: args.tier, limit, used: row?.count ?? limit })
}

// Release a previously-admitted slot when the upload fails before a
// ScannedDocument was durably created (e.g. storage write failed).
export async function releaseDocumentScanSlot(args: {
  userId: string
  month?: string
}): Promise<void> {
  const month = args.month ?? utcMonthBucket()
  await DocumentScanUsageCounter.updateOne(
    { userId: args.userId, month, count: { $gt: 0 } },
    { $inc: { count: -1 } },
  )
}
