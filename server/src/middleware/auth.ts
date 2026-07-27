import type { RequestHandler } from 'express'
import { Unauthorized } from '../lib/errors'
import { verifyAccessToken, type AccessTokenPayload } from '../lib/jwt'

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessTokenPayload
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    next(Unauthorized('missing_token', 'Missing access token'))
    return
  }
  const token = header.slice('Bearer '.length).trim()
  try {
    req.auth = verifyAccessToken(token)
    next()
  } catch {
    next(Unauthorized('invalid_token', 'Invalid or expired access token'))
  }
}
