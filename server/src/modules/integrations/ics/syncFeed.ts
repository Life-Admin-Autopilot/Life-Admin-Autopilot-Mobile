// Pull a feed and reconcile it into matters.
//
// Three rules make repeated polling safe, and each one exists because the
// obvious alternative produces a visible bug:
//
//   1. Upsert on (userId, externalSource, externalId), never blind insert.
//      ICS has no push, so we re-read an overlapping window on every poll. Blind
//      inserts would fan one school assembly into a new matter every hour.
//
//   2. A matter the user deleted stays deleted. Task uses a soft delete, so a
//      poll that ignored `deletedAt` would resurrect everything the user swept
//      away — and they would have to delete it again after every poll, forever.
//
//   3. Updates touch only the timing fields. Once a matter exists the user owns
//      its title, notes and domain; a poll that rewrote them would silently undo
//      "rename this to something I understand". The feed remains authoritative
//      for WHEN, the user for WHAT.

import { logger } from '../../../logger'
import { type IcsFeedDoc } from '../../../models/IcsFeed'
import { Task } from '../../../models/Task'
import { setRulesReminders } from '../../reminders/planReminders'
import { fetchFeed } from './fetchFeed'
import { parseIcsEvents } from './parseIcsEvents'

const DAY_MS = 86_400_000
// Look slightly back so an event that started yesterday is still reconciled,
// and a year forward because school terms and renewals are published far ahead.
const WINDOW_BACK_DAYS = 7
const WINDOW_FORWARD_DAYS = 365

export interface SyncFeedOptions {
  /** The user's IANA zone. Required — a poll has no device to fall back on. */
  timezone: string
  /** The user's 'HH:mm' import default, for all-day events. */
  defaultTimeOfDay?: string
  now?: Date
}

export interface SyncFeedResult {
  status: 'unchanged' | 'synced' | 'gone' | 'error'
  created: number
  updated: number
  /** Occurrences filed as passive list items because their time was ambiguous. */
  needingConfirmation: number
  reason?: string
}

const NOTHING = { created: 0, updated: 0, needingConfirmation: 0 }

/** Task.externalId for one occurrence of one subscription. */
export function externalIdFor(feedId: string, occurrenceId: string): string {
  return `${feedId}::${occurrenceId}`
}

/**
 * Anchored prefix matching every matter a subscription produced. Feed ids are
 * hex ObjectIds, so there are no regex metacharacters to escape — asserted
 * rather than assumed, because a future non-hex id would turn this into an
 * injection point.
 */
export function externalIdPrefixFilter(feedId: string): { $regex: RegExp } {
  if (!/^[a-f0-9]{24}$/i.test(feedId)) throw new Error(`Unexpected feed id shape: ${feedId}`)
  return { $regex: new RegExp(`^${feedId}::`) }
}

export async function syncFeed(
  feed: IcsFeedDoc,
  options: SyncFeedOptions,
): Promise<SyncFeedResult> {
  const now = options.now ?? new Date()

  const response = await fetchFeed(feed.url, {
    etag: feed.etag,
    lastModified: feed.lastModified,
  })

  feed.lastFetchedAt = now

  if (response.status === 'unchanged') {
    // The common case, and the reason polling is affordable: no body, no parse,
    // no writes. A previously failing feed that answers 304 is healthy again.
    feed.status = 'active'
    feed.failureCount = 0
    feed.lastError = undefined
    await feed.save()
    return { status: 'unchanged', ...NOTHING }
  }

  if (response.status === 'gone' || response.status === 'error') {
    feed.failureCount += 1
    feed.lastError = response.reason
    // 'gone' is terminal — a 404 will not start working again on its own, and
    // the user needs to be told rather than left with silently frozen events.
    feed.status = response.status === 'gone' ? 'gone' : 'error'
    await feed.save()
    return { status: response.status, ...NOTHING, reason: response.reason }
  }

  let occurrences
  try {
    occurrences = parseIcsEvents(response.body, {
      timezone: options.timezone,
      defaultTimeOfDay: options.defaultTimeOfDay,
      from: new Date(now.getTime() - WINDOW_BACK_DAYS * DAY_MS),
      to: new Date(now.getTime() + WINDOW_FORWARD_DAYS * DAY_MS),
    })
  } catch (err: unknown) {
    logger.warn({ err, feedId: feed.id }, 'ics:parse-failed')
    feed.failureCount += 1
    feed.status = 'error'
    feed.lastError = 'That feed could not be read.'
    await feed.save()
    return { status: 'error', ...NOTHING, reason: feed.lastError }
  }

  let created = 0
  let updated = 0
  let needingConfirmation = 0

  for (const occurrence of occurrences) {
    if (occurrence.when.needsConfirmation) needingConfirmation += 1

    // Namespace the feed's own UID under the subscription id. Two reasons, both
    // real: UIDs are only required to be unique within a calendar, so two
    // councils can and do both ship "1" — unnamespaced they would collide on the
    // (userId, externalSource, externalId) unique index and one feed would
    // silently overwrite the other. It also makes "retire this feed's matters"
    // an indexed prefix query instead of an unscoped sweep.
    const externalId = externalIdFor(feed.id, occurrence.externalId)

    const existing = await Task.findOne({
      userId: feed.userId,
      externalSource: 'ics_feed',
      externalId,
    })

    // Rule 2: respect a soft delete. The user threw this away; leave it thrown.
    if (existing?.deletedAt) continue

    // An ambiguous time must not fire. `list` is the model's passive kind — it
    // shows on the home list and never nudges — which is exactly the behaviour
    // principles.md asks for below the confidence threshold: surface it, ask,
    // do not act on a guess.
    const kind = occurrence.when.needsConfirmation ? 'list' : 'reminder'

    if (!existing) {
      const task = await Task.create({
        userId: feed.userId,
        title: occurrence.summary,
        domain: feed.domain,
        kind,
        status: 'open',
        priority: 'normal',
        subtasks: [],
        tags: [],
        dueAt: occurrence.when.dueAt,
        notes: occurrence.location ? `${occurrence.location}` : undefined,
        externalSource: 'ics_feed',
        externalId,
        timePrecision: occurrence.when.precision,
        confidence: occurrence.when.confidence,
        reminders: [],
        rescheduleCount: 0,
      })
      await setRulesReminders(task, now)
      created += 1
      continue
    }

    // Rule 3: timing only. Title, notes and domain belong to the user now.
    const movedBy = existing.dueAt
      ? Math.abs(existing.dueAt.getTime() - occurrence.when.dueAt.getTime())
      : Number.POSITIVE_INFINITY
    const timingChanged = movedBy > 60_000 || existing.kind !== kind

    if (!timingChanged) continue

    existing.dueAt = occurrence.when.dueAt
    existing.kind = kind
    existing.timePrecision = occurrence.when.precision
    existing.confidence = occurrence.when.confidence
    await existing.save()
    // Re-plan only because the deadline actually moved — setRulesReminders
    // clears firedAt, so calling it on an unchanged task would re-fire nudges
    // the user already received.
    await setRulesReminders(existing, now)
    updated += 1
  }

  feed.etag = response.etag
  feed.lastModified = response.lastModified
  feed.lastSyncedAt = now
  feed.status = 'active'
  feed.failureCount = 0
  feed.lastError = undefined
  await feed.save()

  return { status: 'synced', created, updated, needingConfirmation }
}
