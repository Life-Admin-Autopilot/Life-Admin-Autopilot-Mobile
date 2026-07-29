import { Router } from 'express'
import { z } from 'zod'

import { BadRequest, NotFound, Unauthorized, asyncHandler } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { IcsFeed } from '../models/IcsFeed'
import { Task, notDeleted } from '../models/Task'
import { DOMAINS, User } from '../models/User'
import { UnsafeFeedUrlError, prepareFeedUrl } from '../modules/integrations/ics/feedUrl'
import { externalIdPrefixFilter, syncFeed } from '../modules/integrations/ics/syncFeed'

export const meIcsFeedsRouter = Router()

const subscribeSchema = z.object({
  url: z.string().min(1).max(2048),
  label: z.string().trim().min(1).max(80),
  domain: z.enum(DOMAINS),
})

// A feed poll runs with no device present, so there is nothing to infer a zone
// from. Rather than let dateOnly throw mid-sync, refuse at the edge with a
// message the client can act on.
async function loadImportContext(
  userId: string,
): Promise<{ timezone: string; defaultTimeOfDay?: string }> {
  const user = await User.findById(userId).select('timezone imports')
  if (!user?.timezone) {
    throw BadRequest(
      'timezone_required',
      'Set your timezone before subscribing to a calendar — imported events have no timezone of their own.',
    )
  }
  return { timezone: user.timezone, defaultTimeOfDay: user.imports?.defaultTimeOfDay }
}

// POST /me/ics-feeds — subscribe to a calendar feed.
//
// Syncs immediately rather than waiting for the poller, because the user is
// standing there and a subscription that shows nothing for an hour reads as
// broken. The sync result is returned so the UI can say what actually landed —
// including how many events were ambiguous enough to need confirming.
meIcsFeedsRouter.post(
  '/me/ics-feeds',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = subscribeSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_feed', 'Check the address, name and category.', parsed.error.issues)
    }

    const context = await loadImportContext(auth.sub)

    // Normalises webcal: and refuses anything that resolves inside our own
    // network. Must happen before the URL is stored, not just before it is
    // fetched — otherwise the poller would happily use it later.
    let url: URL
    try {
      url = await prepareFeedUrl(parsed.data.url)
    } catch (error: unknown) {
      throw BadRequest(
        'unsafe_feed_url',
        error instanceof UnsafeFeedUrlError ? error.message : 'That address cannot be used.',
      )
    }

    const href = url.toString()
    const existing = await IcsFeed.findOne({ userId: auth.sub, url: href })
    // Re-subscribing updates in place. A second row for the same URL would
    // double every matter it produces.
    const feed =
      existing ??
      (await IcsFeed.create({
        userId: auth.sub,
        url: href,
        label: parsed.data.label,
        domain: parsed.data.domain,
        status: 'active',
        failureCount: 0,
      }))

    if (existing) {
      existing.label = parsed.data.label
      existing.domain = parsed.data.domain
      await existing.save()
    }

    const result = await syncFeed(feed, context)
    res.status(existing ? 200 : 201).json({ feed: feed.toJSON(), sync: result })
  }),
)

// GET /me/ics-feeds — the user's subscriptions, with their health.
meIcsFeedsRouter.get(
  '/me/ics-feeds',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const feeds = await IcsFeed.find({ userId: auth.sub }).sort({ createdAt: -1 })
    res.status(200).json({ feeds: feeds.map((f) => f.toJSON()) })
  }),
)

// POST /me/ics-feeds/:id/sync — pull now.
//
// Exists for two reasons: a user who just fixed a broken feed should not wait
// for the next poll, and it is the only way to exercise the pipeline by hand
// before the background poller lands.
meIcsFeedsRouter.post(
  '/me/ics-feeds/:id/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const feed = await IcsFeed.findOne({ _id: req.params.id, userId: auth.sub })
    if (!feed) throw NotFound('feed_not_found', 'That calendar is not connected.')

    const context = await loadImportContext(auth.sub)
    const result = await syncFeed(feed, context)
    res.status(200).json({ feed: feed.toJSON(), sync: result })
  }),
)

// DELETE /me/ics-feeds/:id — unsubscribe.
//
// Also retires this feed's FUTURE open matters. "Stop this calendar" plainly
// means "stop these reminders", and leaving them behind would keep nudging the
// user from a source they just disconnected. Past and completed matters stay:
// they are a record of what happened, and deleting history is not what the user
// asked for.
meIcsFeedsRouter.delete(
  '/me/ics-feeds/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const feed = await IcsFeed.findOne({ _id: req.params.id, userId: auth.sub })
    if (!feed) throw NotFound('feed_not_found', 'That calendar is not connected.')

    const now = new Date()
    const retired = await Task.updateMany(
      {
        userId: auth.sub,
        externalSource: 'ics_feed',
        // Scoped to THIS subscription. An unscoped sweep would retire the
        // matters of every other feed the user still subscribes to.
        externalId: externalIdPrefixFilter(feed.id),
        status: 'open',
        dueAt: { $gt: now },
        ...notDeleted(),
      },
      { $set: { deletedAt: now } },
    )

    await feed.deleteOne()
    res.status(200).json({ removed: true, retiredMatters: retired.modifiedCount })
  }),
)
