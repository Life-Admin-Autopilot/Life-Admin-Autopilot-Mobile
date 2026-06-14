import { env } from '../../env'
import { AppError } from '../../lib/errors'
import { AiUsageCounter, AI_USAGE_KINDS, type AiUsageKind, utcDateBucket } from '../../models/AiUsageCounter'

// Tier-keyed daily quotas. Env-driven for trivial ops tuning.
function quotaFor(tier: 'free' | 'pro', kind: AiUsageKind): number {
  if (kind !== 'message') return 0
  return tier === 'pro' ? env().AI_QUOTA_PRO_DAILY : env().AI_QUOTA_FREE_DAILY
}

export interface QuotaStatus {
  kind: AiUsageKind
  limit: number
  used: number
  remaining: number
  resetAt: string
}

function nextUtcMidnightIso(now: Date = new Date()): string {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0),
  )
  return next.toISOString()
}

export async function getQuotaStatus(args: {
  userId: string
  tier: 'free' | 'pro'
  today?: string
}): Promise<QuotaStatus[]> {
  const today = args.today ?? utcDateBucket()
  const rows = await AiUsageCounter.find({ userId: args.userId, date: today }).lean()
  const usedByKind = new Map<AiUsageKind, number>()
  for (const row of rows) usedByKind.set(row.kind as AiUsageKind, row.count)

  const resetAt = nextUtcMidnightIso()
  return AI_USAGE_KINDS.map((kind) => {
    const used = usedByKind.get(kind) ?? 0
    const limit = quotaFor(args.tier, kind)
    return {
      kind,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetAt,
    }
  })
}

function quotaExceeded(args: {
  tier: 'free' | 'pro'
  kind: AiUsageKind
  limit: number
  used: number
}): AppError {
  return new AppError(
    402,
    'quota_exceeded',
    `You've hit today's limit of ${args.limit} ${args.kind}s.`,
    {
      kind: args.kind,
      tier: args.tier,
      limit: args.limit,
      used: args.used,
      resetAt: nextUtcMidnightIso(),
    },
  )
}

// ATOMIC ADMISSION — reserve one quota slot in a single conditional write,
// closing the check-then-increment TOCTOU race. The old flow read the count,
// later $inc'd on done; two concurrent requests could both pass the read and
// then both increment past the limit. Here the limit guard and the increment
// happen in ONE updateOne: only a row whose count is still below the limit
// matches and gets bumped. A no-match means the slot is full → 402.
//
// `upsert: true` with the `count: { $lt: limit }` guard is subtle: when the
// row doesn't exist yet the filter can't match (no doc has count < limit),
// so the upsert INSERTS a fresh row. Mongo seeds the inserted doc from the
// filter's equality fields + the $inc, yielding count = 1 on first use. A
// duplicate-key error (two racing upserts) is retried once as a pure $inc,
// which then re-evaluates the guard.
//
// Reconciles with record-on-done: the slot is consumed HERE (before the
// work). Callers must releaseUsageSlot() if the work fails before producing
// a result, so a crashed/aborted turn doesn't permanently burn a slot.
export async function admitWithinQuota(args: {
  userId: string
  tier: 'free' | 'pro'
  kind: AiUsageKind
  today?: string
}): Promise<void> {
  const today = args.today ?? utcDateBucket()
  const limit = quotaFor(args.tier, args.kind)
  if (limit <= 0) {
    throw quotaExceeded({ tier: args.tier, kind: args.kind, limit, used: 0 })
  }

  const filter = {
    userId: args.userId,
    date: today,
    kind: args.kind,
    count: { $lt: limit },
  }

  try {
    const res = await AiUsageCounter.updateOne(
      filter,
      { $inc: { count: 1 } },
      { upsert: true },
    )
    // Matched-and-incremented OR inserted-fresh → admitted.
    if (res.modifiedCount > 0 || res.upsertedCount > 0) return
  } catch (err: unknown) {
    // Duplicate key: a concurrent request inserted the row between our guard
    // miss and the upsert. Retry as a pure guarded $inc (no upsert) — the row
    // now exists, so the guard alone decides admission.
    if (!isDuplicateKeyError(err)) throw err
    const retry = await AiUsageCounter.updateOne(filter, { $inc: { count: 1 } })
    if (retry.modifiedCount > 0) return
  }

  // No matching row to increment and nothing inserted → the row exists at or
  // above the limit. Surface the live count for the upgrade prompt.
  const row = await AiUsageCounter.findOne({
    userId: args.userId,
    date: today,
    kind: args.kind,
  }).lean()
  throw quotaExceeded({
    tier: args.tier,
    kind: args.kind,
    limit,
    used: row?.count ?? limit,
  })
}

// Unconditional increment — count a message that is NOT subject to the daily
// gate. Used only for the post-confirmation continuation, which is the SAME
// logical turn the user already paid for; we still record it so the visible
// counter reflects the extra Gemini round, but we never refuse it.
export async function recordUsage(args: {
  userId: string
  kind: AiUsageKind
  today?: string
}): Promise<void> {
  const today = args.today ?? utcDateBucket()
  await AiUsageCounter.updateOne(
    { userId: args.userId, date: today, kind: args.kind },
    { $inc: { count: 1 } },
    { upsert: true },
  )
}

// Release a previously-admitted slot when the work fails before a result is
// produced (e.g. the Gemini stream errored after admission). Never drops the
// counter below zero. Idempotency is the caller's concern — release at most
// once per admit.
export async function releaseUsageSlot(args: {
  userId: string
  kind: AiUsageKind
  today?: string
}): Promise<void> {
  const today = args.today ?? utcDateBucket()
  await AiUsageCounter.updateOne(
    { userId: args.userId, date: today, kind: args.kind, count: { $gt: 0 } },
    { $inc: { count: -1 } },
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
