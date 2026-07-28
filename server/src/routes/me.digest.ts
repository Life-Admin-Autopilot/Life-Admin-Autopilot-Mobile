import { Router } from 'express'
import { z } from 'zod'

import { asyncHandler, BadRequest, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { buildDailyDigest } from '../modules/tasks/dailyDigest'

export const meDigestRouter = Router()

// `tz` is the caller's IANA zone. The digest describes a local calendar day, so
// without it the whole thing is anchored to the wrong midnight. Only the length
// is checked here — buildDailyDigest validates the zone itself and falls back
// to UTC, because a typo must not take the endpoint down.
const DigestQuerySchema = z.object({ tz: z.string().max(64).optional() }).strict()

// GET /me/digest — the dashboard's every-visit read.
//
// Deliberately NOT gated on isAiConfigured(): the counts are the valuable part
// and they need no model at all. When AI is unavailable, exhausted, or simply
// broken, this still returns a complete digest with a computed headline. The
// only things that can fail this route are auth and the database.
meDigestRouter.get(
  '/me/digest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = DigestQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw BadRequest('invalid_query', 'Invalid digest query.', parsed.error.flatten())
    }

    const digest = await buildDailyDigest({
      userId: auth.sub,
      timezone: parsed.data.tz,
    })

    res.status(200).json({ digest })
  }),
)
