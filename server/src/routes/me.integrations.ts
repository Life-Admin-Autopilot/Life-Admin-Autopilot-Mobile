import { Router } from 'express'
import { asyncHandler, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'

export const meIntegrationsRouter = Router()

// Connected third-party services. Returns an empty list until OAuth handlers
// exist — the frontend shows preview tiles in a "coming soon" state.
meIntegrationsRouter.get(
  '/me/integrations',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw Unauthorized()
    res.status(200).json({ integrations: [] })
  }),
)
