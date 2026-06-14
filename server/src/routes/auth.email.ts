import { Router } from 'express'
import { z } from 'zod'
import { consumeVerificationToken } from '../lib/authFlows'
import { asyncHandler, BadRequest } from '../lib/errors'
import { authLimiter } from '../middleware/rateLimit'
import { User } from '../models/User'

export const authEmailRouter = Router()

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
