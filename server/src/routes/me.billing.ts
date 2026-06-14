import { Router } from 'express'
import { asyncHandler, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'

export const meBillingRouter = Router()

// Invoice history. Returns an empty list until a real payment provider (Stripe)
// is wired up — the frontend renders a designed empty state from this shape.
meBillingRouter.get(
  '/me/billing/invoices',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.auth) throw Unauthorized()
    res.status(200).json({ invoices: [] })
  }),
)
