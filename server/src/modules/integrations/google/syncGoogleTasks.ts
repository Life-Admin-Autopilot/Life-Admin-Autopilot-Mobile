// Import Google Tasks as matters.
//
// Two properties of this API shape everything here:
//
//   1. `due` IS DATE-ONLY. Google's own reference: "Only date information is
//      recorded; the time portion of the timestamp is discarded" and "It isn't
//      possible to read or write the time that a task is scheduled for using
//      the API." Task.ts requires a reminder to carry a real dueAt, so every
//      imported task goes through the date-only policy in ../dateOnly.ts and
//      lands on the user's OWN stated import time. We never invent one.
//
//   2. THERE ARE NO WEBHOOKS. The Tasks API has no `watch` method, unlike
//      Calendar. Polling with `updatedMin` is the only option, which makes the
//      idempotent upsert in ../reconcileMatter.ts load-bearing rather than
//      defensive.
//
// Note also that `showDeleted` and `showHidden` both default to FALSE, so a
// naive call never sees completions or cleared items and the matter stays open
// in Kitto forever.

import { logger } from '../../../logger'
import type { IntegrationDoc } from '../../../models/Integration'
import type { Domain } from '../../../models/User'
import { resolveDateOnly } from '../dateOnly'
import { reconcileExternalMatter } from '../reconcileMatter'
import { getAccessToken, hasScope } from './connection'
import { SCOPE_TASKS } from './oauthClient'

const API = 'https://tasks.googleapis.com/tasks/v1'
// The API's own ceiling for tasks.list.
const PAGE_SIZE = 100
// Stop a runaway account from pulling forever in one tick.
const MAX_PAGES = 20
// Re-read a little before the last sync so an item updated during the previous
// request is not missed in the gap between "read" and "recorded".
const OVERLAP_MS = 5 * 60_000

export interface GoogleTasksSyncResult {
  status: 'synced' | 'skipped'
  created: number
  updated: number
  reason?: string
}

interface GoogleTaskList {
  id?: string
  title?: string
}

interface GoogleTask {
  id?: string
  title?: string
  notes?: string
  status?: 'needsAction' | 'completed'
  due?: string
  deleted?: boolean
  hidden?: boolean
  updated?: string
}

async function getJson<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    throw new Error(`Google Tasks returned ${response.status}`)
  }
  return (await response.json()) as T
}

async function listTaskLists(accessToken: string): Promise<GoogleTaskList[]> {
  const json = await getJson<{ items?: GoogleTaskList[] }>(
    `${API}/users/@me/lists?maxResults=100`,
    accessToken,
  )
  return json.items ?? []
}

async function listTasks(
  listId: string,
  accessToken: string,
  updatedMin: Date | undefined,
): Promise<GoogleTask[]> {
  const out: GoogleTask[] = []
  let pageToken: string | undefined

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${API}/lists/${encodeURIComponent(listId)}/tasks`)
    url.searchParams.set('maxResults', String(PAGE_SIZE))
    // Both default to false. Without them a completed or cleared task simply
    // vanishes from the response, which is indistinguishable from "unchanged" —
    // so Kitto would keep nudging about something already done.
    url.searchParams.set('showDeleted', 'true')
    url.searchParams.set('showHidden', 'true')
    url.searchParams.set('showCompleted', 'true')
    if (updatedMin) url.searchParams.set('updatedMin', updatedMin.toISOString())
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const json = await getJson<{ items?: GoogleTask[]; nextPageToken?: string }>(
      url.toString(),
      accessToken,
    )
    out.push(...(json.items ?? []))

    pageToken = json.nextPageToken
    if (!pageToken) break
  }

  return out
}

export interface SyncGoogleTasksOptions {
  /** The user's IANA zone. Required — a poll has no device to infer one from. */
  timezone: string
  defaultTimeOfDay?: string
  /** Where imported tasks are filed. Google Tasks carries no life-domain hint. */
  domain: Domain
  now?: Date
}

export async function syncGoogleTasks(
  integration: IntegrationDoc,
  options: SyncGoogleTasksOptions,
): Promise<GoogleTasksSyncResult> {
  // The consent screen lets a user grant Calendar and decline Tasks. Calling
  // anyway would 403 on every tick with nothing explaining why.
  if (!hasScope(integration, SCOPE_TASKS)) {
    return { status: 'skipped', created: 0, updated: 0, reason: 'Tasks access was not granted.' }
  }

  const now = options.now ?? new Date()
  const accessToken = await getAccessToken(integration)

  const since = integration.updatedAt
    ? new Date(integration.updatedAt.getTime() - OVERLAP_MS)
    : undefined

  let created = 0
  let updated = 0

  for (const list of await listTaskLists(accessToken)) {
    if (!list.id) continue

    for (const task of await listTasks(list.id, accessToken, since)) {
      if (!task.id) continue
      // A task deleted upstream is not our business to recreate, and Kitto has
      // no delete-propagation story yet — leaving the local matter alone is the
      // conservative choice over silently removing something the user may have
      // edited here.
      if (task.deleted) continue

      const title = task.title?.trim()
      // Google permits empty titles; a blank matter helps nobody.
      if (!title) continue
      // A task with no due date is not a reminder — Kitto would have nothing to
      // fire on. Skipped rather than filed as an undated list item so an import
      // does not dump someone's entire backlog into the matters list.
      if (!task.due) continue

      let resolved
      try {
        resolved = resolveDateOnly({
          // `due` arrives as a full RFC3339 stamp whose time part is always
          // zeroed and meaningless. Taking the date half is not lossy — there is
          // nothing in the other half to lose.
          date: task.due.slice(0, 10),
          timezone: options.timezone,
          defaultTimeOfDay: options.defaultTimeOfDay,
        })
      } catch (err: unknown) {
        logger.warn({ err, taskId: task.id }, 'googleTasks:unresolvable-due')
        continue
      }

      const outcome = await reconcileExternalMatter(
        {
          userId: integration.userId,
          externalSource: 'google_tasks',
          externalId: task.id,
          title,
          domain: options.domain,
          dueAt: resolved.dueAt,
          kind: 'reminder',
          timePrecision: resolved.precision,
          confidence: resolved.confidence,
          notes: task.notes?.trim() || undefined,
          completed: task.status === 'completed',
        },
        now,
      )

      if (outcome.created) created += 1
      if (outcome.updated) updated += 1
    }
  }

  return { status: 'synced', created, updated }
}
