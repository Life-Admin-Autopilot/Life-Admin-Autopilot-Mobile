import { env } from '../env'
import { logger } from '../logger'
import { IcsFeed, type IcsFeedDoc } from '../models/IcsFeed'
import { User } from '../models/User'
import { syncFeed } from '../modules/integrations/ics/syncFeed'

// Background poller for subscribed calendar feeds.
//
// Mirrors reminderWorker: a polled interval with a small batch. The pacing is
// very different though, because ICS is not a live protocol — a school-term or
// bin-collection feed changes perhaps three times a year, and every poll in
// between is a conditional GET that ends in a 304 with no body. Polling more
// often would buy nothing and cost the publisher bandwidth, so the tick is
// frequent (to spread work) but each individual feed is only eligible every few
// hours.

const TICK_MS = 5 * 60_000
// How often a healthy feed is re-read.
const FEED_INTERVAL_MS = 6 * 60 * 60_000
// Small batch: each feed is a network round trip, and there is no deadline
// pressure — a feed read twenty minutes late is indistinguishable from one read
// on time.
const BATCH = 10
// Failing feeds back off exponentially so a dead URL is not hammered every six
// hours forever. Capped so a feed that comes back is picked up within a day.
const MAX_BACKOFF_STEPS = 4

let timer: ReturnType<typeof setInterval> | null = null

/** When this feed next becomes eligible, given how badly it has been failing. */
function nextDueAt(feed: IcsFeedDoc): number {
  const last = feed.lastFetchedAt?.getTime() ?? 0
  const steps = Math.min(feed.failureCount, MAX_BACKOFF_STEPS)
  return last + FEED_INTERVAL_MS * 2 ** steps
}

async function runOnce(now: Date = new Date()): Promise<void> {
  // 'gone' is terminal — a 404 does not start working again on its own, and the
  // user has already been told. Re-polling it forever would be pure waste.
  const candidates = await IcsFeed.find({ status: { $in: ['active', 'error'] } })
    .sort({ lastFetchedAt: 1 })
    .limit(BATCH * 4)

  const due = candidates.filter((feed) => nextDueAt(feed) <= now.getTime()).slice(0, BATCH)
  if (due.length === 0) return

  // One lookup for the batch rather than per feed — a household's feeds cluster
  // onto very few users.
  const users = await User.find(
    { _id: { $in: due.map((f) => f.userId) } },
    { timezone: 1, imports: 1 },
  ).lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))

  for (const feed of due) {
    const user = byId.get(String(feed.userId))

    // No device is present during a poll, so a missing timezone cannot be
    // guessed — dateOnly would throw. Mark it plainly rather than failing in a
    // loop the user cannot see.
    if (!user?.timezone) {
      feed.lastFetchedAt = now
      feed.status = 'error'
      feed.lastError = 'Set your timezone to keep this calendar in sync.'
      await feed.save()
      continue
    }

    try {
      const result = await syncFeed(feed, {
        timezone: user.timezone,
        defaultTimeOfDay: user.imports?.defaultTimeOfDay,
        now,
      })
      if (result.status === 'synced') {
        logger.info(
          {
            feedId: feed.id,
            created: result.created,
            updated: result.updated,
            needingConfirmation: result.needingConfirmation,
          },
          'icsFeedWorker:synced',
        )
      }
    } catch (err: unknown) {
      // syncFeed already records feed-level failures; this catches anything
      // unexpected so one bad feed cannot end the tick for the others.
      logger.error({ err, feedId: feed.id }, 'icsFeedWorker:feed-failed')
    }
  }
}

export function startIcsFeedWorker(): void {
  if (timer) return
  if (env().NODE_ENV === 'test') return
  timer = setInterval(() => {
    void runOnce().catch((err: unknown) => logger.error({ err }, 'icsFeedWorker:tick-failed'))
  }, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('icsFeedWorker:started')
}

export function stopIcsFeedWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// Exported for tests and for the manual sync path.
export { runOnce as runIcsFeedTick }
