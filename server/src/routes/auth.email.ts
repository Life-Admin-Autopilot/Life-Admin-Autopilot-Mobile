import { Router } from 'express'
import { z } from 'zod'
import { consumeCode, consumeVerificationToken, sendEmailVerificationCode } from '../lib/authFlows'
import { asyncHandler, BadRequest, NotFound, Unauthorized } from '../lib/errors'
import { logger } from '../logger'
import { requireAuth } from '../middleware/auth'
import { authLimiter, strictAuthLimiter } from '../middleware/rateLimit'
import { CODE_LENGTH } from '../lib/tokens'
import { User } from '../models/User'

export const authEmailRouter = Router()

const CodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${CODE_LENGTH}}$`), 'Enter the 6-digit code.'),
})

const VerifyEmailSchema = z.object({
  token: z.string().min(1),
})

authEmailRouter.post(
  '/auth/verify-email',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { token } = VerifyEmailSchema.parse(req.body)
    const userId = await consumeVerificationToken(token, 'email_verification')
    if (!userId) {
      throw BadRequest(
        'invalid_verification_token',
        'This verification link is invalid or has expired.',
      )
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { emailVerifiedAt: new Date() } },
      { new: true },
    )
    if (!user) throw BadRequest('invalid_verification_token', 'Account not found.')

    res.status(200).json({ user: user.toJSON() })
  }),
)

// -- Code-based verification (the in-app path) -------------------------------
// The token routes above stay for the mailed-link path; these are what the
// Profile screen drives, because a `lifeadmin://` link has nothing registered
// to open it yet.

authEmailRouter.post(
  '/auth/verify-email/send-code',
  requireAuth,
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    // Already verified is a no-op, not an error: the client may be racing a
    // second tab, and failing here would show a scary message for a good state.
    if (user.emailVerifiedAt) {
      res.status(204).end()
      return
    }
    // Awaited, unlike signup's fire-and-forget: the user is staring at a code
    // field, so "we sent it" must not be a guess.
    try {
      await sendEmailVerificationCode(user)
    } catch (err: unknown) {
      logger.error({ err, userId: user.id }, 'auth:verify-email:code-email-failed')
      throw BadRequest('email_send_failed', 'We could not send that email. Try again in a moment.')
    }
    res.status(204).end()
  }),
)

authEmailRouter.post(
  '/auth/verify-email/confirm-code',
  requireAuth,
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = CodeSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_code', 'Enter the 6-digit code.', parsed.error.flatten())
    }

    const ok = await consumeCode(auth.sub, 'email_verification_code', parsed.data.code)
    if (!ok) {
      throw BadRequest('invalid_code', 'That code is wrong or has expired. Send a new one.')
    }

    const user = await User.findByIdAndUpdate(
      auth.sub,
      { $set: { emailVerifiedAt: new Date() } },
      { new: true },
    )
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')

    res.status(200).json({ user: user.toJSON() })
  }),
)
