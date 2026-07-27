import { Router } from 'express'
import { z } from 'zod'
import { consumeVerificationToken, sendMagicLinkEmail } from '../lib/authFlows'
import { asyncHandler, BadRequest, NotFound } from '../lib/errors'
import { sessionMetaFromRequest } from '../lib/requestMeta'
import { issueSession } from '../lib/sessions'
import { logger } from '../logger'
import { authLimiter, strictAuthLimiter } from '../middleware/rateLimit'
import { User } from '../models/User'

export const authMagicRouter = Router()

const RequestMagicLinkSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
})

authMagicRouter.post(
  '/auth/magic-link',
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const { email } = RequestMagicLinkSchema.parse(req.body)

    // Auto-create on first request so passwordless onboarding works.
    let user = await User.findOne({ email })
    if (!user) {
      user = await User.create({ email })
    }

    sendMagicLinkEmail(user).catch((err) => {
      logger.error({ err, userId: user?.id }, 'auth:magic-link:email-failed')
    })

    res.status(204).end()
  }),
)

const ConsumeMagicLinkSchema = z.object({
  token: z.string().min(1),
})

authMagicRouter.post(
  '/auth/magic-consume',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = ConsumeMagicLinkSchema.parse(req.body)

    const userId = await consumeVerificationToken(token, 'magic_link')
    if (!userId) {
      throw BadRequest(
        'invalid_magic_token',
        'This sign-in link is invalid or has expired. Request a new one.',
      )
    }

    const user = await User.findById(userId)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')

    // A successful magic-link sign-in implies the user controls the email.
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date()
      await user.save()
    }

    const tokens = await issueSession(user, undefined, sessionMetaFromRequest(req))
    res.status(200).json({ user: user.toJSON(), tokens })
  }),
)
