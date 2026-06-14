import { Router } from 'express'
import { asyncHandler, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { User } from '../models/User'

export const meSubscriptionRouter = Router()

meSubscriptionRouter.get(
  '/me/subscription',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const user = await User.findById(auth.sub).lean()
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    // Subscription is server-managed; defaults to the free tier.
    res.status(200).json({ subscription: user.subscription ?? { tier: 'free' } })
  }),
)
