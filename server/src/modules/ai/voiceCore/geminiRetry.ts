import { logger } from '../../../logger'

// Gemini intermittently returns 503 UNAVAILABLE / 429 / 5xx under load — all
// transient. Shared so transcription and extraction retry identically.

export function isTransientGeminiError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string }
  const codes = [429, 500, 503, 504]
  if (typeof e?.status === 'number' && codes.includes(e.status)) return true
  if (typeof e?.code === 'number' && codes.includes(e.code)) return true
  const msg = typeof e?.message === 'string' ? e.message : ''
  return /unavailable|overloaded|high demand|try again later|rate.?limit|internal error/i.test(msg)
}

const DEFAULT_MAX_ATTEMPTS = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Retry a Gemini call on transient failures with linear backoff. Non-transient
// errors (4xx other than 429) bubble immediately.
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      if (attempt < maxAttempts && isTransientGeminiError(err)) {
        const delay = 500 * attempt
        logger.warn({ attempt, delay, label }, 'gemini:retry-transient')
        await sleep(delay)
        continue
      }
      throw err
    }
  }
  throw lastErr
}
