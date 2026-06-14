import expressRateLimit from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'

import { AppError } from '../lib/errors'

// Disable rate limiting under test so suites can exercise an endpoint many
// times without tripping any counter — applies to BOTH the library auth
// limiters below and the hand-rolled per-user limiter.
const skipInTest = (): boolean => process.env.NODE_ENV === 'test'

export const authLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many requests. Try again in a few minutes.',
    },
  },
})

export const strictAuthLimiter = expressRateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many attempts. Try again later.',
    },
  },
})

// ---------------------------------------------------------------------------
// Per-user sliding-window limiter (hand-rolled).
//
// The AI + voice endpoints are expensive (each call burns a Gemini round and
// real money) and previously had NO rate limit at all — a single client could
// hammer /ai/ask or the voice upload as fast as the network allowed. This
// limiter keys per authenticated user (falling back to IP for unauthenticated
// callers) and uses a true sliding window: it tracks each hit's timestamp and
// only counts hits inside the trailing `windowMs`, so bursts at a window
// boundary can't sneak through the way a fixed-window counter allows.
//
// In-memory only (single-process v1, same as pendingToolStore). A stale-entry
// sweep on each hit keeps the map bounded; idle keys fall out on their own.
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  windowMs: number
  max: number
  // Derives the bucket key for a request. Defaults to the authed user id,
  // then the request IP.
  keyBy?: (req: Request) => string
}

function defaultKeyBy(req: Request): string {
  return req.auth?.sub ?? req.ip ?? 'unknown'
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, keyBy = defaultKeyBy } = options
  // key → ascending list of hit timestamps (ms) still inside the window.
  const hits = new Map<string, number[]>()

  return (req, res, next) => {
    if (skipInTest()) {
      next()
      return
    }

    const now = Date.now()
    const cutoff = now - windowMs
    const key = keyBy(req)

    // Sweep this key's window, then opportunistically drop any other key whose
    // newest hit has aged out entirely — keeps the map from growing unbounded.
    const existing = hits.get(key) ?? []
    const recent = existing.filter((t) => t > cutoff)

    if (recent.length >= max) {
      const oldest = recent[0] ?? now
      const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      next(
        new AppError(
          429,
          'rate_limited',
          'You are going a little fast — give it a moment and try again.',
        ),
      )
      return
    }

    recent.push(now)
    hits.set(key, recent)
    sweepIdleKeys(hits, cutoff)
    next()
  }
}

function sweepIdleKeys(hits: Map<string, number[]>, cutoff: number): void {
  for (const [k, timestamps] of hits) {
    const newest = timestamps[timestamps.length - 1] ?? 0
    if (newest <= cutoff) hits.delete(k)
  }
}

// Endpoint limiters. Caps are intentionally generous — they exist to stop
// runaway loops / abuse, not to throttle normal use.
//   /ai/ask:               ~30 requests / minute / user
//   /ai/tools/confirm:     ~30 requests / minute / user (same logical turn)
//   voice upload + chat transcribe: ~12 / minute / user (audio is heavier)
const MINUTE_MS = 60 * 1000

export const aiAskLimiter = rateLimit({ windowMs: MINUTE_MS, max: 30 })
export const aiConfirmLimiter = rateLimit({ windowMs: MINUTE_MS, max: 30 })
export const aiVoiceLimiter = rateLimit({ windowMs: MINUTE_MS, max: 12 })
