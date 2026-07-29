// Import Google Calendar events.
//
// Unlike Tasks, Calendar has a real incremental protocol — a `syncToken` that
// returns only what changed. Three of its behaviours are load-bearing:
//
//   1. A 410 Gone is an INSTRUCTION, not a failure. Google expires sync tokens
//      on its own schedule; the documented response is to wipe the local cursor
//      and do a full sync. Code that treats 410 as an error gets stuck
//      permanently, because the token never becomes valid again.
//
//   2. `singleEvents=true` makes Google expand recurrence for us. Doing it
//      ourselves would repeat the whole RRULE/DST problem already solved once in
//      the ICS path, against an API that will happily do it correctly.
//
//   3. A sync-token request CANNOT carry timeMin/timeMax — Google rejects the
//      combination. So the window is applied on the full sync only, and
//      incremental results are filtered locally.
//
// Events are triaged before anything is written (see triageEvent.ts): only
// `matter` becomes a Kitto matter. `commitment` is counted and reported but not
// persisted — nothing consumes busy blocks until the conflict engine in
// smart-reminder-conflict-spec.md exists, and storing data with no reader is
// just a migration to write later.

import { logger } from '../../../logger'
import type { IntegrationDoc } from '../../../models/Integration'
import type { Domain } from '../../../models/User'
import { resolveDateOnly } from '../dateOnly'
import { reconcileExternalMatter } from '../reconcileMatter'
import { getAccessToken, hasScope } from './connection'
import { SCOPE_CALENDAR } from './oauthClient'
import { triageEvent, type TriageEvent } from './triageEvent'

const API = 'https://www.googleapis.com/calendar/v3'
const PAGE_SIZE = 250
const MAX_PAGES = 20
const DAY_MS = 86_400_000
const WINDOW_BACK_DAYS = 7
const WINDOW_FORWARD_DAYS = 365

export interface GoogleCalendarSyncResult {
  status: 'synced' | 'skipped'
  created: number
  updated: number
  /** Meetings and recurring slots — seen, deliberately not filed as matters. */
  commitments: number
  ignored: number
  /** True when a 410 forced us to discard the cursor and re-read everything. */
  fullResync: boolean
  reason?: string
}

interface GoogleEvent extends TriageEvent {
  id?: string
  summary?: string
  description?: string
  location?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] }
}

class SyncTokenExpiredError extends Error {}

async function getEventsPage(
  url: URL,
  accessToken: string,
): Promise<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string }> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })

  if (response.status === 410) throw new SyncTokenExpiredError()
  if (!response.ok) throw new Error(`Google Calendar returned ${response.status}`)

  return (await response.json()) as {
    items?: GoogleEvent[]
    nextPageToken?: string
    nextSyncToken?: string
  }
}

async function readEvents(
  accessToken: string,
  syncToken: string | undefined,
  now: Date,
): Promise<{ events: GoogleEvent[]; nextSyncToken?: string }> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/calendars/primary/events`)
    url.searchParams.set('maxResults', String(PAGE_SIZE))
    url.searchParams.set('singleEvents', 'true')
    // Needed to see deletions: a removed event arrives as a cancelled tombstone
    // rather than simply vanishing.
    url.searchParams.set('showDeleted', 'true')

    if (syncToken) {
      url.searchParams.set('syncToken', syncToken)
    } else {
      // Only legal on a full sync — Google rejects timeMin alongside syncToken.
      url.searchParams.set('timeMin', new Date(now.getTime() - WINDOW_BACK_DAYS * DAY_MS).toISOString())
      url.searchParams.set(
        'timeMax',
        new Date(now.getTime() + WINDOW_FORWARD_DAYS * DAY_MS).toISOString(),
      )
      url.searchParams.set('orderBy', 'startTime')
    }
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const json = await getEventsPage(url, accessToken)
    events.push(...(json.items ?? []))

    // The sync token only appears on the LAST page. Storing one from a middle
    // page would silently skip every event on the pages after it.
    if (json.nextSyncToken) nextSyncToken = json.nextSyncToken
    pageToken = json.nextPageToken
    if (!pageToken) break
  }

  return { events, nextSyncToken }
}

export interface SyncGoogleCalendarOptions {
  timezone: string
  defaultTimeOfDay?: string
  /** Where imported events are filed. */
  domain: Domain
  now?: Date
}

export async function syncGoogleCalendar(
  integration: IntegrationDoc,
  options: SyncGoogleCalendarOptions,
): Promise<GoogleCalendarSyncResult> {
  if (!hasScope(integration, SCOPE_CALENDAR)) {
    return {
      status: 'skipped',
      created: 0,
      updated: 0,
      commitments: 0,
      ignored: 0,
      fullResync: false,
      reason: 'Calendar access was not granted.',
    }
  }

  const now = options.now ?? new Date()
  const accessToken = await getAccessToken(integration)

  let fullResync = false
  let read: { events: GoogleEvent[]; nextSyncToken?: string }
  try {
    read = await readEvents(accessToken, integration.calendarSyncToken, now)
  } catch (err: unknown) {
    if (!(err instanceof SyncTokenExpiredError)) throw err
    // Documented recovery, not a failure path.
    logger.info({ integrationId: integration.id }, 'googleCalendar:sync-token-expired')
    fullResync = true
    integration.calendarSyncToken = undefined
    read = await readEvents(accessToken, undefined, now)
  }

  const from = new Date(now.getTime() - WINDOW_BACK_DAYS * DAY_MS)
  const to = new Date(now.getTime() + WINDOW_FORWARD_DAYS * DAY_MS)

  let created = 0
  let updated = 0
  let commitments = 0
  let ignored = 0

  for (const event of read.events) {
    const role = triageEvent(event)
    if (role === 'ignore') {
      ignored += 1
      continue
    }
    if (role === 'commitment') {
      commitments += 1
      continue
    }
    if (!event.id) continue

    const title = event.summary?.trim()
    if (!title) continue

    let dueAt: Date
    let precision: 'exact' | 'dateOnly'
    let confidence: 'high' | 'low'

    if (event.start?.dateTime) {
      // RFC3339 with a real offset — unambiguous, nothing to assume.
      dueAt = new Date(event.start.dateTime)
      precision = 'exact'
      confidence = 'high'
      if (Number.isNaN(dueAt.getTime())) continue
    } else if (event.start?.date) {
      try {
        const resolved = resolveDateOnly({
          date: event.start.date,
          timezone: options.timezone,
          defaultTimeOfDay: options.defaultTimeOfDay,
        })
        dueAt = resolved.dueAt
        precision = 'dateOnly'
        confidence = 'high'
      } catch (err: unknown) {
        logger.warn({ err, eventId: event.id }, 'googleCalendar:unresolvable-start')
        continue
      }
    } else {
      continue
    }

    // Incremental results are not window-bounded (syncToken and timeMin cannot
    // be combined), so the filter is applied here instead.
    if (dueAt < from || dueAt > to) continue

    // Does Google already alert on this? `useDefault` means the calendar's own
    // default reminders apply, which for most people is a popup before the
    // event — so both branches count.
    const sourceHasOwnAlerts =
      event.reminders?.useDefault === true || (event.reminders?.overrides?.length ?? 0) > 0

    const outcome = await reconcileExternalMatter(
      {
        userId: integration.userId,
        externalSource: 'google_calendar',
        externalId: event.id,
        title,
        domain: options.domain,
        dueAt,
        kind: 'reminder',
        timePrecision: precision,
        confidence,
        notes: event.location?.trim() || undefined,
        sourceHasOwnAlerts,
      },
      now,
    )

    if (outcome.created) created += 1
    if (outcome.updated) updated += 1
  }

  if (read.nextSyncToken) integration.calendarSyncToken = read.nextSyncToken
  integration.calendarSyncedAt = now
  await integration.save()

  return { status: 'synced', created, updated, commitments, ignored, fullResync }
}
