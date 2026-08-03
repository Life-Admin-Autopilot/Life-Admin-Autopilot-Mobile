// The once-a-month, per-language allowance for translating a backlog.
//
// Cloned from lib/documentScanQuota.ts — same monthly bucket, same three-phase
// atomic admission, same `nextMonthStart` reset. Two deliberate differences:
//
//   1. The bucket carries the TARGET LOCALE, so switching to a third language
//      next week is not blocked by having translated into Arabic today.
//   2. The limit is 1 and does not vary by tier. This is not a volume guard like
//      scans — it is "you get one sweep of your backlog per language per month",
//      which is the same sentence for everyone.
//
// NO REFUND, deliberately, and for the reason documented at
// routes/me.documentScans.ts:208-212: refunding on undo would make
// translate → undo → translate an unlimited loop around the cap. A run that
// produced nothing is the one exception, handled by the caller before it commits.

import { AppError } from '../../lib/errors'
import { utcMonthBucket } from '../../models/DocumentScanUsageCounter'
import { TranslationUsageCounter } from '../../models/TranslationUsageCounter'
import type { AiLocale } from '../ai/promptLanguage'

/** One backlog sweep per language per month, every tier. */
export const TRANSLATE_RUNS_PER_MONTH = 1

export interface TranslateQuotaStatus {
  locale: AiLocale
  limit: number
  used: number
  remaining: number
  resetAt: string
}

// `month` is a `YYYY-MM` UTC bucket; the reset is midnight UTC on the 1st of the
// following month. `Date.UTC` takes a 0-indexed month, so passing the 1-based
// `mon` straight through lands on the first of the NEXT month — and December
// rolls into January via the same overflow handling. Deliberate, not a bug.
function nextMonthStart(month: string): string {
  const [year, mon] = month.split('-').map((part) => Number(part))
  return new Date(Date.UTC(year ?? 1970, mon ?? 1, 1)).toISOString()
}

function quotaExceeded(locale: AiLocale, resetAt: string): AppError {
  return new AppError(
    402,
    'translate_quota_exceeded',
    'Your matters have already been translated into this language this month.',
    { locale, limit: TRANSLATE_RUNS_PER_MONTH, used: TRANSLATE_RUNS_PER_MONTH, resetAt },
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

export async function readTranslateQuota(args: {
  userId: string
  locale: AiLocale
  month?: string
}): Promise<TranslateQuotaStatus> {
  const month = args.month ?? utcMonthBucket()
  const row = await TranslationUsageCounter.findOne({
    userId: args.userId,
    month,
    locale: args.locale,
  }).lean()
  const used = row?.count ?? 0
  return {
    locale: args.locale,
    limit: TRANSLATE_RUNS_PER_MONTH,
    used,
    remaining: Math.max(0, TRANSLATE_RUNS_PER_MONTH - used),
    resetAt: nextMonthStart(month),
  }
}

/**
 * Claims this month's run for `locale`. Throws 402 when it is already spent.
 *
 * The filter carries `count: { $lt: limit }` AND upserts, so a missing row can
 * only be inserted by the racer that wins; the loser gets a duplicate-key error
 * and retries as a pure guarded `$inc`. See the long comment in
 * modules/ai/quota.ts for the full TOCTOU reasoning this pattern encodes.
 */
export async function admitTranslateRun(args: {
  userId: string
  locale: AiLocale
  month?: string
}): Promise<void> {
  const month = args.month ?? utcMonthBucket()
  const filter = {
    userId: args.userId,
    month,
    locale: args.locale,
    count: { $lt: TRANSLATE_RUNS_PER_MONTH },
  }

  try {
    const res = await TranslationUsageCounter.updateOne(
      filter,
      { $inc: { count: 1 } },
      { upsert: true },
    )
    if (res.modifiedCount > 0 || res.upsertedCount > 0) return
  } catch (err: unknown) {
    if (!isDuplicateKeyError(err)) throw err
    const retry = await TranslationUsageCounter.updateOne(filter, { $inc: { count: 1 } })
    if (retry.modifiedCount > 0) return
  }

  throw quotaExceeded(args.locale, nextMonthStart(month))
}

/**
 * Hands the month back. Called ONLY when a run produced nothing at all — no
 * matter matched the selection, or every batch failed — so the user was charged
 * a month for no output. Never called on undo: see the header.
 */
export async function releaseTranslateRun(args: {
  userId: string
  locale: AiLocale
  month?: string
}): Promise<void> {
  const month = args.month ?? utcMonthBucket()
  await TranslationUsageCounter.updateOne(
    { userId: args.userId, month, locale: args.locale, count: { $gt: 0 } },
    { $inc: { count: -1 } },
  )
}
