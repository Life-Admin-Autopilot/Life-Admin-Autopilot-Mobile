import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, NotFound, Unauthorized } from '../lib/errors'
import { sessionMetaFromRequest } from '../lib/requestMeta'
import {
  listUserSessions,
  revokeOtherSessions,
  revokeRefreshToken,
  revokeSessionById,
  rotateRefreshToken,
} from '../lib/sessions'
import { requireAuth } from '../middleware/auth'
import { authLimiter } from '../middleware/rateLimit'
import { User } from '../models/User'

export const authSessionRouter = Router()

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

authSessionRouter.post(
  '/auth/refresh',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { refreshToken } = RefreshSchema.parse(req.body)
    const tokens = await rotateRefreshToken(refreshToken, sessionMetaFromRequest(req))
    if (!tokens) {
      throw Unauthorized(
        'invalid_refresh_token',
        'This session has expired. Please sign in again.',
      )
    }
    res.status(200).json({ tokens })
  }),
)

authSessionRouter.post(
  '/auth/signout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = RefreshSchema.safeParse(req.body)
    if (parsed.success) {
      await revokeRefreshToken(parsed.data.refreshToken)
    }
    res.status(204).end()
  }),
)

authSessionRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')
    res.status(200).json({ user: user.toJSON() })
  }),
)

// -- Session management (settings → security) -----------------------------
// `list` and `revoke-others` accept the caller's refresh token in the body so
// the current device can be flagged and preserved. POST (not GET) for list so
// the token never lands in a URL/log.

const SessionContextSchema = z.object({
  refreshToken: z.string().min(1).optional(),
})

authSessionRouter.post(
  '/auth/sessions/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const { refreshToken } = SessionContextSchema.parse(req.body ?? {})
    const sessions = await listUserSessions(auth.sub, refreshToken)
    res.status(200).json({ sessions })
  }),
)

authSessionRouter.delete(
  '/auth/sessions/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const id = req.params.id
    if (typeof id !== 'string') throw NotFound('session_not_found', 'That session is no longer active.')
    const revoked = await revokeSessionById(auth.sub, id)
    if (!revoked) throw NotFound('session_not_found', 'That session is no longer active.')
    res.status(204).end()
  }),
)

authSessionRouter.post(
  '/auth/sessions/revoke-others',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const { refreshToken } = RefreshSchema.parse(req.body)
    await revokeOtherSessions(auth.sub, refreshToken)
    res.status(204).end()
  }),
)
