import { env } from '../env'
import { logger } from '../logger'
import { Integration, type IntegrationDoc } from '../models/Integration'
import { User } from '../models/User'
import { IntegrationUnavailableError } from '../modules/integrations/google/connection'
import { syncGoogleCalendar } from '../modules/integrations/google/syncGoogleCalendar'
import { syncGoogleTasks } from '../modules/integrations/google/syncGoogleTasks'

// Background poller for connected Google accounts.
//
// Calendar has push notifications, but they are NOT a substitute for this loop:
// watch channels expire in about 7 days with no auto-renewal, and a missed
// renewal kills the change stream with no user-visible error — reminders simply
// stop arriving. Google's own sync guidance is to reconcile out of band for
// exactly that reason. Tasks has no push at all, so polling is its only option.
//
// Every tick is cheap even when nothing changed: Calendar answers a syncToken
// request with an empty list, and Tasks is filtered by updatedMin.

const TICK_MS = 5 * 60_000
const INTERVAL_MS = 60 * 60_000
const BATCH = 10
const MAX_BACKOFF_STEPS = 4

let timer: ReturnType<typeof setInterval> | null = null

function nextDueAt(integration: IntegrationDoc): number {
  const last = integration.calendarSyncedAt?.getTime() ?? 0
  // `needs_reauth` is not polled at all — see runOnce's filter — so backoff only
  // has to pace transient failures.
  const steps = integration.lastError ? Math.min(MAX_BACKOFF_STEPS, 2) : 0
  return last + INTERVAL_MS * 2 ** steps
}

async function runOnce(now: Date = new Date()): Promise<void> {
  // A connection needing re-auth is terminal until the user acts. Polling it
  // would fail every tick forever while they see nothing.
  const candidates = await Integration.find({ provider: 'google', status: 'active' })
    .sort({ calendarSyncedAt: 1 })
    .limit(BATCH * 4)

  const due = candidates.filter((i) => nextDueAt(i) <= now.getTime()).slice(0, BATCH)
  if (due.length === 0) return

  const users = await User.find(
    { _id: { $in: due.map((i) => i.userId) } },
    { timezone: 1, imports: 1 },
  ).lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))

  for (const integration of due) {
    const user = byId.get(String(integration.userId))

    // No device is present during a poll, so a missing timezone cannot be
    // guessed — every date-only Google Task would resolve against the wrong day.
    if (!user?.timezone) {
      integration.lastError = 'Set your timezone to keep importing from Google.'
      integration.calendarSyncedAt = now
      await integration.save()
      continue
    }

    const options = {
      timezone: user.timezone,
      defaultTimeOfDay: user.imports?.defaultTimeOfDay,
      domain: integration.importDomain,
      now,
    }

    try {
      const calendar = await syncGoogleCalendar(integration, options)
      const tasks = await syncGoogleTasks(integration, options)
      integration.tasksSyncedAt = now
      integration.lastError = undefined
      await integration.save()

      logger.info(
        {
          integrationId: integration.id,
          created: calendar.created + tasks.created,
          updated: calendar.updated + tasks.updated,
          commitments: calendar.commitments,
          fullResync: calendar.fullResync,
        },
        'googleSyncWorker:synced',
      )
    } catch (err: unknown) {
      // getAccessToken already flips the row to needs_reauth when Google says
      // invalid_grant, so this branch only records the message for the UI.
      if (err instanceof IntegrationUnavailableError) {
        logger.info({ integrationId: integration.id }, 'googleSyncWorker:needs-reauth')
        continue
      }
      logger.error({ err, integrationId: integration.id }, 'googleSyncWorker:failed')
      integration.lastError = 'Last import failed. Kitto will try again.'
      integration.calendarSyncedAt = now
      await integration.save()
    }
  }
}

export function startGoogleSyncWorker(): void {
  if (timer) return
  if (env().NODE_ENV === 'test') return
  timer = setInterval(() => {
    void runOnce().catch((err: unknown) => logger.error({ err }, 'googleSyncWorker:tick-failed'))
  }, TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
  logger.info('googleSyncWorker:started')
}

export function stopGoogleSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export { runOnce as runGoogleSyncTick }
