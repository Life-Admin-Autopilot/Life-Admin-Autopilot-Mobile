import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { PipelineStage, Types } from 'mongoose'

import { logger } from '../../logger'
import { Task, notDeleted } from '../../models/Task'
import { Clarification, visibleOpen } from '../../models/Clarification'
import { ScannedDocument } from '../../models/ScannedDocument'
import {
  DailyDigest,
  type DailyDigestCounts,
  type DailyDigestPayload,
} from '../../models/DailyDigest'
import { keepRealThemes, writeDigestProse } from './dailyDigestProse'
import { findDuplicates } from './summarize'
import { dayBoundaries, toUserObjectId } from './taskQuery'

// The dashboard's daily digest — the cached, every-visit sibling of
// summarizeRange.
//
// The rule from summarize.ts applies here verbatim and is the whole design:
// EVERY number is computed in code from real documents. The model names themes
// and writes one sentence. A figure that came out of a language model is a
// surface for confident wrong answers the user cannot check, and this one is
// on screen the moment they open the app.
//
// What is different is the economics. summarizeRange is a mutation the user
// asks for; this loads on every dashboard visit, so a Gemini call per request
// is not affordable. Hence the cache in models/DailyDigest: the counts are
// recomputed against a cheap state fingerprint, and the model is only asked
// for prose when that fingerprint has actually moved.

// The model never sees more than this many matters. Same ceiling as the range
// summary — past it the themes stop being about anything.
const MAX_TASKS_TO_MODEL = 120

// Cap on the rows read to sum today's estimates. A personal backlog does not
// put hundreds of matters on one day; if it somehow does, the estimate
// undercounts rather than the query going unbounded. `dueToday` is counted
// separately and stays exact either way.
const MAX_TODAY_ROWS = 200

const DAY_MS = 86_400_000
// Overdue by more than a fortnight, or moved three times: the same slipping
// rule taskCounts uses, so the digest and the Matters header cannot disagree.
const SLIP_DAYS = 14
const SLIP_MOVES = 3

// ---- Time ----

// An IANA zone arrives from the client and is only length-checked at the route.
// Every Intl call below — and Mongo's $dateToString — throws on a bad one, so a
// typo'd zone would take out an endpoint that is contractually not allowed to
// fail. Validate once, fall back to UTC.
function safeTimezone(timezone: string | undefined): string | undefined {
  if (!timezone) return undefined
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone })
    return timezone
  } catch {
    logger.warn({ timezone }, 'daily-digest:invalid-timezone')
    return undefined
  }
}

// 'YYYY-MM-DD' in the caller's zone. en-CA formats in exactly that order, which
// is the same round-trip summarize.ts uses to bucket its busiest day.
function localDateKey(at: Date, timezone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

// ---- Source fingerprint ----

// What the cache is keyed on besides the date: a cheap summary of every
// document the digest reads. Count plus newest-updated per collection catches
// creates, edits, completions and soft deletes — mongoose stamps updatedAt on
// all of them, and anything that leaves the matched set moves the count.
//
// Within one local day nothing else can change a figure: the day boundaries,
// the slipping cutoff and the busiest-day window are all fixed relative to the
// local midnight that is already part of the key. So identical fingerprint +
// identical date means identical numbers.
interface SourceState {
  hash: string
  // Both fall out of the fingerprint queries, so the digest gets them free.
  needsInput: number
  scansAwaitingReview: number
}

interface CountAndStamp {
  n: number
  updated: Date | null
}

// Structural over the three models rather than three copies of the same
// pipeline. Only `aggregate` is needed, so that is all the parameter asks for.
interface Aggregatable {
  aggregate: (pipeline: PipelineStage[]) => { exec: () => Promise<Record<string, unknown>[]> }
}

async function tally(
  model: Aggregatable,
  match: Record<string, unknown>,
): Promise<CountAndStamp> {
  const [row] = await model
    .aggregate([
      { $match: match },
      { $group: { _id: null, n: { $sum: 1 }, updated: { $max: '$updatedAt' } } },
    ])
    .exec()
  return {
    n: typeof row?.n === 'number' ? row.n : 0,
    updated: row?.updated instanceof Date ? row.updated : null,
  }
}

async function readSourceState(
  uid: Types.ObjectId,
  localDate: string,
  now: Date,
): Promise<SourceState> {
  const [tasks, clarifications, scans] = await Promise.all([
    tally(Task, { userId: uid, ...notDeleted() }),
    // `now` is threaded through rather than left to visibleOpen's default: the
    // digest is called with an injected clock (tests, and any backfill), and a
    // deferred question judged against the wall clock instead would make this
    // count disagree with taskCounts for the same instant.
    tally(Clarification, { userId: uid, ...visibleOpen(now) }),
    tally(ScannedDocument, { userId: uid, status: 'ready_for_review' }),
  ])

  const parts = [localDate, tasks, clarifications, scans]
    .map((p) =>
      typeof p === 'string' ? p : `${p.n}:${p.updated ? p.updated.toISOString() : '-'}`,
    )
    .join('|')

  return {
    hash: createHash('sha256').update(parts).digest('hex'),
    needsInput: clarifications.n,
    scansAwaitingReview: scans.n,
  }
}

// ---- Estimates ----

// `estimate` is optional on every matter and absent from every matter created
// before it existed, so it is validated on the way in rather than assumed. The
// rows are read with `.lean()`, which returns what Mongo stored rather than
// what the schema promises, so nothing here can lean on the model's guarantees.
// A matter with no usable estimate contributes zero — never a guess, which
// would be a fabricated number in a digest whose whole premise is that it has
// none.
const EstimateSchema = z.object({
  minMinutes: z.number().min(0),
  maxMinutes: z.number().min(0),
})

function readEstimate(row: unknown): { min: number; max: number } {
  const parsed = EstimateSchema.safeParse((row as { estimate?: unknown })?.estimate)
  if (!parsed.success) return { min: 0, max: 0 }
  const { minMinutes, maxMinutes } = parsed.data
  // Defend the invariant rather than trusting it — a max below min would
  // render as a backwards range.
  return { min: minMinutes, max: Math.max(minMinutes, maxMinutes) }
}

// ---- The computed half ----

interface ComputedDigest {
  counts: DailyDigestCounts
  estimatedMinutesToday: { min: number; max: number }
  busiestDay: { date: string; count: number } | null
  duplicates: DailyDigestPayload['duplicates']
  /** The matters the model is allowed to name, newest deadline first. */
  pool: Record<string, unknown>[]
}

async function computeDigest(args: {
  uid: Types.ObjectId
  now: Date
  timezone: string | undefined
  source: SourceState
}): Promise<ComputedDigest> {
  const { uid, now, timezone, source } = args
  const { todayStart, tomorrowStart, weekEnd } = dayBoundaries(now, timezone)
  const live = { userId: uid, ...notDeleted(), status: { $in: ['open', 'snoozed'] } }

  const [facet, todayRows, poolRows] = await Promise.all([
    Task.aggregate([
      { $match: { userId: uid, ...notDeleted() } },
      {
        $facet: {
          dueToday: [
            { $match: { ...live, dueAt: { $gte: todayStart, $lt: tomorrowStart } } },
            { $count: 'n' },
          ],
          completedToday: [
            {
              $match: {
                userId: uid,
                status: 'done',
                completedAt: { $gte: todayStart, $lt: tomorrowStart },
              },
            },
            { $count: 'n' },
          ],
          openTotal: [{ $match: { userId: uid, status: 'open' } }, { $count: 'n' }],
          slipping: [
            {
              $match: {
                ...live,
                $or: [
                  { rescheduleCount: { $gte: SLIP_MOVES } },
                  { dueAt: { $lt: new Date(todayStart.getTime() - SLIP_DAYS * DAY_MS) } },
                ],
              },
            },
            { $count: 'n' },
          ],
          // Heaviest day in the week ahead — the input to "want me to spread
          // these out?". Grouped by Mongo in the caller's zone so it agrees
          // with the local dates the rest of the digest is built on. Ties break
          // on the earlier date so the answer is stable between rebuilds.
          busiestDay: [
            { $match: { ...live, dueAt: { $gte: todayStart, $lt: weekEnd } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    date: '$dueAt',
                    format: '%Y-%m-%d',
                    timezone: timezone ?? 'UTC',
                  },
                },
                n: { $sum: 1 },
              },
            },
            { $sort: { n: -1, _id: 1 } },
            { $limit: 1 },
          ],
        },
      },
    ]),
    Task.find({ ...live, dueAt: { $gte: todayStart, $lt: tomorrowStart } })
      .limit(MAX_TODAY_ROWS)
      .lean(),
    // Everything live with a deadline inside the horizon, overdue included.
    // The themes, the duplicate check and the model's view all come from this
    // one set so they cannot describe different days.
    Task.find({ ...live, dueAt: { $lt: weekEnd } })
      .sort({ dueAt: 1 })
      .limit(MAX_TASKS_TO_MODEL)
      .lean(),
  ])

  const scalar = (key: string): number =>
    (facet?.[0]?.[key]?.[0]?.n as number | undefined) ?? 0

  const busiest = facet?.[0]?.busiestDay?.[0] as { _id: string; n: number } | undefined

  const estimatedMinutesToday = todayRows.reduce(
    (acc, row) => {
      const { min, max } = readEstimate(row)
      return { min: acc.min + min, max: acc.max + max }
    },
    { min: 0, max: 0 },
  )

  const pool = poolRows as unknown as Record<string, unknown>[]

  return {
    counts: {
      dueToday: scalar('dueToday'),
      completedToday: scalar('completedToday'),
      openTotal: scalar('openTotal'),
      slipping: scalar('slipping'),
      needsInput: source.needsInput,
      scansAwaitingReview: source.scansAwaitingReview,
    },
    estimatedMinutesToday,
    busiestDay: busiest ? { date: busiest._id, count: busiest.n } : null,
    duplicates: findDuplicates(poolRows),
    pool,
  }
}

// ---- The neutral headline ----

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// What the digest says when there is no model to say it better. Factual and
// finished — it reports the day, it does not grade the person. Nothing here
// counts what they failed to do, because the one line at the top of the app is
// the worst possible place to put that.
function neutralHeadline(counts: DailyDigestCounts): string {
  if (counts.dueToday > 0) {
    return `${plural(counts.dueToday, 'matter', 'matters')} due today.`
  }
  if (counts.completedToday > 0) {
    return `Nothing due today. ${plural(counts.completedToday, 'matter', 'matters')} closed.`
  }
  if (counts.needsInput > 0) {
    return `Nothing due today. ${plural(counts.needsInput, 'question is', 'questions are')} waiting on you.`
  }
  if (counts.openTotal === 0) return 'Nothing on today.'
  return 'Nothing due today.'
}

// ---- Entry point ----

export interface BuildDailyDigestArgs {
  userId: string | Types.ObjectId
  /** Caller's IANA zone. Day boundaries are meaningless without it. */
  timezone?: string
  now?: Date
}

// Cached read-through. Serves the stored row when the local date and the source
// fingerprint both match; otherwise recomputes, asks the model for prose, and
// writes the row back.
export async function buildDailyDigest(
  args: BuildDailyDigestArgs,
): Promise<DailyDigestPayload> {
  const now = args.now ?? new Date()
  const timezone = safeTimezone(args.timezone)
  const uid = toUserObjectId(args.userId)
  const localDate = localDateKey(now, timezone)

  const [source, cached] = await Promise.all([
    readSourceState(uid, localDate, now),
    DailyDigest.findOne({ userId: uid, localDate }).lean(),
  ])

  if (cached && cached.sourceHash === source.hash) {
    return fromCache(cached.payload)
  }

  const computed = await computeDigest({ uid, now, timezone, source })

  // The prose is NOT awaited. It used to be, and that one `await` was the
  // slowest thing on the home screen: every count here is already in hand after
  // the aggregation above, and they were then made to wait on a language model
  // writing a single sentence. Worse, the wait landed on exactly the visits that
  // matter — a cache miss means the user just changed something, so the moment
  // they act is the moment the dashboard goes quiet. The counts ship now with
  // the computed headline; the model's sentence is written in the background and
  // lands on the next read. A plain sentence immediately beats a nicer one late.
  //
  // Themes carry over from the last successful build, re-validated against
  // today's matters, so they are stale only in wording. The headline is never
  // carried: a sentence about yesterday presented as today is a lie, whereas a
  // plain count is merely plain.
  const poolIds = new Set(computed.pool.map((row) => String(row._id)))
  const themes = keepRealThemes(cached?.payload.themes ?? [], poolIds)

  const payload: DailyDigestPayload = {
    localDate,
    generatedAt: now.toISOString(),
    headline: neutralHeadline(computed.counts),
    counts: computed.counts,
    estimatedMinutesToday: computed.estimatedMinutesToday,
    themes,
    busiestDay: computed.busiestDay,
    duplicates: computed.duplicates,
  }

  try {
    await DailyDigest.findOneAndUpdate(
      { userId: uid, localDate },
      { $set: { sourceHash: source.hash, generatedAt: now, payload } },
      { upsert: true },
    )
  } catch (err: unknown) {
    // A concurrent dashboard load inserted the same row first (unique index).
    // The payload in hand is still correct — serving it beats failing on a
    // cache write.
    logger.warn({ err }, 'daily-digest:cache-write-failed')
  }

  trackProse(refineProse({ uid, localDate, sourceHash: source.hash, pool: computed.pool, now }))

  return payload
}

// In-flight background prose jobs.
//
// Production never reads this — the whole point is that nothing waits. It
// exists so TESTS can be deterministic: an unawaited promise outlives the case
// that started it, and a model call from one test then shows up in the next
// one's spy. A fire-and-forget with no handle is untestable by construction.
const inFlightProse = new Set<Promise<void>>()

function trackProse(job: Promise<void>): void {
  inFlightProse.add(job)
  void job.finally(() => inFlightProse.delete(job))
}

/** Test-only: settle every background prose refresh started so far. */
export function whenDigestProseSettled(): Promise<void> {
  return Promise.all([...inFlightProse]).then(() => undefined)
}

// Upgrade a just-written digest row from the computed headline to the model's,
// in the background. Fire-and-forget: nothing on the dashboard waits for it and
// a failure leaves a complete, honest digest in place.
//
// The $match includes sourceHash, which is the whole safety argument: by the
// time this resolves the user may have filed three more matters, and the row
// will have been rewritten against a new fingerprint. Matching on the hash this
// prose was generated FROM means a late write lands only if it is still true,
// and is silently dropped otherwise. Without that guard the slow path would
// staple a sentence about the old state onto the new counts.
async function refineProse(args: {
  uid: Types.ObjectId
  localDate: string
  sourceHash: string
  pool: Record<string, unknown>[]
  now: Date
}): Promise<void> {
  const { uid, localDate, sourceHash, pool, now } = args
  try {
    const prose = await writeDigestProse({ userId: String(uid), pool, now })
    if (!prose) return

    const set: Record<string, unknown> = { 'payload.headline': prose.headline }
    if (prose.themes.length > 0) set['payload.themes'] = prose.themes

    await DailyDigest.updateOne({ userId: uid, localDate, sourceHash }, { $set: set })
  } catch (err: unknown) {
    logger.warn({ err, localDate }, 'daily-digest:prose-refine-failed')
  }
}

// Rebuild the response from a lean cache row. Explicit rather than spread so a
// field added to the schema without a migration surfaces as a type error here
// instead of silently missing from the response.
function fromCache(payload: DailyDigestPayload): DailyDigestPayload {
  return {
    localDate: payload.localDate,
    generatedAt: payload.generatedAt,
    headline: payload.headline,
    counts: {
      dueToday: payload.counts.dueToday,
      completedToday: payload.counts.completedToday,
      openTotal: payload.counts.openTotal,
      slipping: payload.counts.slipping,
      needsInput: payload.counts.needsInput,
      scansAwaitingReview: payload.counts.scansAwaitingReview,
    },
    estimatedMinutesToday: {
      min: payload.estimatedMinutesToday.min,
      max: payload.estimatedMinutesToday.max,
    },
    themes: payload.themes.map((t) => ({
      label: t.label,
      count: t.count,
      taskIds: [...t.taskIds],
    })),
    busiestDay: payload.busiestDay ? { ...payload.busiestDay } : null,
    duplicates: payload.duplicates.map((d) => ({
      title: d.title,
      count: d.count,
      taskIds: [...d.taskIds],
    })),
  }
}
