import { Router } from 'express'
import { z } from 'zod'
import { consumeCode, sendEmailChangeCode } from '../lib/authFlows'
import { asyncHandler, BadRequest, Conflict, NotFound, Unauthorized } from '../lib/errors'
import { verifyPassword } from '../lib/password'
import { revokeOtherSessions } from '../lib/sessions'
import { CODE_LENGTH } from '../lib/tokens'
import { logger } from '../logger'
import { requireAuth } from '../middleware/auth'
import { strictAuthLimiter } from '../middleware/rateLimit'
import { User } from '../models/User'

// Changing the address you sign in with, in two steps.
//
//   1. POST /auth/change-email        — prove it's you (password), stash the
//                                       target as `pendingEmail`, mail a code
//                                       TO THE NEW ADDRESS.
//   2. POST /auth/change-email/confirm — redeem the code, swap the address.
//
// The split is the whole point: the account keeps authenticating as the OLD
// address until someone proves they can read mail at the new one, so a typo or
// a hostile address can never lock the owner out. Uniqueness is re-checked at
// step 2, because an address that was free when the code was issued may have
// been claimed by the time it's redeemed.

export const authEmailChangeRouter = Router()

const RequestSchema = z.object({
  newEmail: z.string().email().toLowerCase().trim(),
  // Optional in the schema, required in the handler when the account has a
  // password — mirrors DELETE /me, so magic-link-only accounts still work.
  password: z.string().min(1).optional(),
})

authEmailChangeRouter.post(
  '/auth/change-email',
  requireAuth,
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = RequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', "That didn't look like an email address.", parsed.error.flatten())
    }
    const { newEmail, password } = parsed.data

    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')

    if (newEmail === user.email) {
      throw BadRequest('email_unchanged', "That's already your email address.")
    }

    if (user.passwordHash) {
      if (!password) {
        throw BadRequest('password_required', 'Enter your password to change your email.')
      }
      const ok = await verifyPassword(user.passwordHash, password)
      if (!ok) throw Unauthorized('invalid_credentials', 'That password is incorrect.')
    }

    const taken = await User.exists({ email: newEmail })
    if (taken) throw Conflict('email_taken', 'An account with this email already exists.')

    user.pendingEmail = newEmail
    await user.save()

    try {
      await sendEmailChangeCode(user, newEmail)
    } catch (err: unknown) {
      logger.error({ err, userId: user.id }, 'auth:change-email:email-failed')
      throw BadRequest('email_send_failed', 'We could not send that email. Try again in a moment.')
    }

    res.status(200).json({ user: user.toJSON() })
  }),
)

const ConfirmSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{${CODE_LENGTH}}$`), 'Enter the 6-digit code.'),
  /** Kept alive while every other session is revoked, so the caller stays in. */
  refreshToken: z.string().min(1).optional(),
})

authEmailChangeRouter.post(
  '/auth/change-email/confirm',
  requireAuth,
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const parsed = ConfirmSchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_code', 'Enter the 6-digit code.', parsed.error.flatten())
    }
    const { code, refreshToken } = parsed.data

    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    if (!user.pendingEmail) {
      throw BadRequest('no_pending_email', "There's no email change waiting.")
    }

    const ok = await consumeCode(auth.sub, 'email_change', code)
    if (!ok) {
      throw BadRequest('invalid_code', 'That code is wrong or has expired. Send a new one.')
    }

    // Re-check: the code proves control of the inbox, not that the address is
    // still free. Someone else may have signed up with it in the last 15 min.
    const taken = await User.exists({ email: user.pendingEmail, _id: { $ne: user._id } })
    if (taken) {
      user.pendingEmail = undefined
      await user.save()
      throw Conflict('email_taken', 'An account with this email already exists.')
    }

    user.email = user.pendingEmail
    user.pendingEmail = undefined
    // Redeeming a code sent to this address IS proof of control.
    user.emailVerifiedAt = new Date()
    await user.save()

    // The sign-in identity just changed, so anything holding the old one is
    // stale. Keep this device signed in; push everything else back to the door.
    if (refreshToken) {
      await revokeOtherSessions(user.id, refreshToken)
    }

    res.status(200).json({ user: user.toJSON() })
  }),
)

authEmailChangeRouter.delete(
  '/auth/change-email',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    user.pendingEmail = undefined
    await user.save()
    res.status(204).end()
  }),
)
