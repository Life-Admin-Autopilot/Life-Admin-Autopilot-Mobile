import type { Request } from 'express'
import type { SessionMeta } from './sessions'

// Extract device/network metadata from a request so issued sessions are
// attributable in the security → sessions list. User-agent is truncated to
// keep the stored string bounded.
export function sessionMetaFromRequest(req: Request): SessionMeta {
  const ua = req.headers['user-agent']
  return {
    userAgent: typeof ua === 'string' ? ua.slice(0, 256) : undefined,
    ip: req.ip,
  }
}
