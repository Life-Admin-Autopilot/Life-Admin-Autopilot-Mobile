// Backend error → friendly user-facing string. The Express backend already
// returns friendly messages on its ApiError codes (e.g. invalid_credentials →
// "Wrong email or password."), so we mostly surface err.message — but we guard
// against raw codes/stack traces leaking, translate a few known codes, and give
// network/5xx their own copy. Catch blocks call this instead of stringifying
// err.message directly (AGENTS.md → UI voice: errors are factual, never Error 503).

import { ApiError } from '@/lib/api/client'

const FRIENDLY_BY_CODE: Record<string, string> = {
  invalid_credentials: 'Wrong email or password.',
  email_taken: 'An account with this email already exists.',
  invalid_body: 'Some of those details looked off. Check the fields and try again.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
}

// Heuristic: raw codes, stack traces, or massive strings shouldn't reach the UI.
function looksLikeRawError(message: string): boolean {
  if (message.length > 140) return true
  if (/^[a-z0-9_]+$/i.test(message) && !message.includes(' ')) return true
  if (message.includes('Error:')) return true
  if (message.includes('\n')) return true
  return false
}

export function translateBackendError(
  err: unknown,
  fallback = 'Something went wrong. Try again in a moment.',
): string {
  if (err instanceof ApiError) {
    const mapped = FRIENDLY_BY_CODE[err.code]
    if (mapped) return mapped
    if (err.status >= 500) return 'Our end hiccuped. Try again in a moment.'
    if (err.status === 401 || err.status === 403) return 'Sign in again to continue.'
    if (err.status === 404) return "Couldn't find that — it may have been removed."
    if (err.message && !looksLikeRawError(err.message)) return err.message
    return fallback
  }

  // Browser fetch surfaces network failures as TypeError ("Failed to fetch").
  if (err instanceof TypeError) return 'No connection. Check your internet and try again.'

  if (err instanceof Error && err.message && !looksLikeRawError(err.message)) return err.message

  return fallback
}
