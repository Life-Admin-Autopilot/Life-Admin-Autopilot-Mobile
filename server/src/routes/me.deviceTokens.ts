import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, BadRequest, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { DEVICE_PLATFORMS, MAX_DEVICE_TOKENS, User } from '../models/User'

export const meDeviceTokensRouter = Router()

const BodySchema = z.object({
  token: z.string().min(1).max(256),
  platform: z.enum(DEVICE_PLATFORMS),
})

// Register (or refresh) this device's Expo push token. Deduped by token,
// newest-first, capped — so re-registering on each launch never grows unbounded.
meDeviceTokensRouter.post(
  '/me/device-tokens',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = BodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid device token payload.', parsed.error.flatten())
    }

    const user = await User.findById(auth.sub)
    if (!user) throw Unauthorized()

    const { token, platform } = parsed.data
    const others = user.deviceTokens.filter((d) => d.token !== token)
    user.deviceTokens = [{ token, platform, registeredAt: new Date() }, ...others].slice(
      0,
      MAX_DEVICE_TOKENS,
    )
    await user.save()

    res.status(200).json({ ok: true, count: user.deviceTokens.length })
  }),
)
