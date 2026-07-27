import { Router } from 'express'
import { z } from 'zod'
import { sendPasswordResetEmail, sendVerificationEmail, consumeVerificationToken } from '../lib/authFlows'
import { asyncHandler, BadRequest, Conflict, Unauthorized } from '../lib/errors'
import { hashPassword, verifyPassword } from '../lib/password'
import { sessionMetaFromRequest } from '../lib/requestMeta'
import { issueSession, revokeAllUserSessions, revokeOtherSessions } from '../lib/sessions'
import { logger } from '../logger'
import { requireAuth } from '../middleware/auth'
import { authLimiter, strictAuthLimiter } from '../middleware/rateLimit'
import { User } from '../models/User'

export const authPasswordRouter = Router()

const SignupSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(8).max(128),
})

authPasswordRouter.post(
  '/auth/signup',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = SignupSchema.parse(req.body)

    const existing = await User.findOne({ email }).lean()
    if (existing) throw Conflict('email_taken', 'An account with this email already exists.')

    const passwordHash = await hashPassword(password)
    const user = await User.create({ email, passwordHash })

    const tokens = await issueSession(user, undefined, sessionMetaFromRequest(req))

    sendVerificationEmail(user).catch((err) => {
      logger.error({ err, userId: user.id }, 'auth:signup:verification-email-failed')
    })

    res.status(201).json({ user: user.toJSON(), tokens })
  }),
)

const SigninSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
})

authPasswordRouter.post(
  '/auth/signin',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = SigninSchema.parse(req.body)

    const user = await User.findOne({ email })
    if (!user || !user.passwordHash) {
      throw Unauthorized('invalid_credentials', 'Wrong email or password.')
    }

    const ok = await verifyPassword(user.passwordHash, password)
    if (!ok) throw Unauthorized('invalid_credentials', 'Wrong email or password.')

    const tokens = await issueSession(user, undefined, sessionMetaFromRequest(req))
    res.status(200).json({ user: user.toJSON(), tokens })
  }),
)

const ForgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
})

authPasswordRouter.post(
  '/auth/forgot-password',
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const { email } = ForgotPasswordSchema.parse(req.body)

    // Always return 204 — don't leak whether the email exists.
    const user = await User.findOne({ email })
    if (user) {
      sendPasswordResetEmail(user).catch((err) => {
        logger.error({ err, userId: user.id }, 'auth:forgot-password:email-failed')
      })
    }

    res.status(204).end()
  }),
)

const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
})

authPasswordRouter.post(
  '/auth/reset-password',
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const { token, newPassword } = ResetPasswordSchema.parse(req.body)

    const userId = await consumeVerificationToken(token, 'password_reset')
    if (!userId) {
      throw BadRequest(
        'invalid_reset_token',
        'This reset link is invalid or has expired. Please request a new one.',
      )
    }

    const user = await User.findById(userId)
    if (!user) throw BadRequest('invalid_reset_token', 'Account not found.')

    user.passwordHash = await hashPassword(newPassword)
    await user.save()

    await revokeAllUserSessions(user.id)

    res.status(204).end()
  }),
)

const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    // The caller's refresh token — kept alive while every other session is
    // revoked, so changing your password signs out other devices but not this one.
    refreshToken: z.string().min(1).optional(),
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from your current one.',
    path: ['newPassword'],
  })

authPasswordRouter.post(
  '/auth/change-password',
  requireAuth,
  strictAuthLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const { currentPassword, newPassword, refreshToken } = ChangePasswordSchema.parse(req.body)

    const user = await User.findById(auth.sub)
    if (!user || !user.passwordHash) {
      throw BadRequest('no_password_set', 'This account has no password to change.')
    }

    const ok = await verifyPassword(user.passwordHash, currentPassword)
    if (!ok) throw Unauthorized('invalid_credentials', 'Your current password is incorrect.')

    user.passwordHash = await hashPassword(newPassword)
    await user.save()

    if (refreshToken) {
      await revokeOtherSessions(user.id, refreshToken)
    } else {
      await revokeAllUserSessions(user.id)
    }

    res.status(204).end()
  }),
)
