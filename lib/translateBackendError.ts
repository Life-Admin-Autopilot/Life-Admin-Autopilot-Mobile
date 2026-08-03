// Backend error → friendly user-facing string, in the user's language.
//
// The catalogue is authoritative, not `err.message`. That inverts what this file
// used to do, and the inversion is the whole point: the Express backend writes
// its ApiError messages in English, so surfacing `err.message` put an English
// sentence in front of an Arabic reader on every error the client had not mapped.
// errors.byCode covers the server's full code list, so a known code is answered
// from the catalogue and the server's own wording is never shown.
//
// `err.message` survives only as a last resort BEFORE the generic fallback, and
// only in English. In any other locale an unmapped code falls to errors.generic —
// a vague sentence in the right language beats a precise one in the wrong one,
// and it puts pressure on adding the code to the catalogue rather than letting
// English leak.
//
// Reads the catalogue directly rather than taking a translator: see the header of
// lib/i18n/staticMessages.ts for why this file is one of the three exceptions.

import { ApiError } from '@/lib/api/client'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { currentLocale } from '@/lib/i18n/localeStore'
import { staticMessages } from '@/lib/i18n/staticMessages'

type ByCode = ReturnType<typeof staticMessages>['errors']['byCode']

function friendlyByCode(code: string): string | null {
  const byCode = staticMessages().errors.byCode as Record<string, string | undefined>
  return byCode[code] ?? null
}

/**
 * `invalid_credentials` means "wrong email or password" at the sign-in door, but
 * inside Settings the email is not in question — only the password is. Callers
 * re-confirming a password pass this so the message names the right field.
 *
 * A function, not a constant: the copy has to be read at call time or it freezes
 * whichever language happened to be active when the module first loaded.
 */
export function reauthMessages(): Readonly<Record<string, string>> {
  return { invalid_credentials: staticMessages().errors.reauthPassword }
}

// Heuristic: raw codes, stack traces, or massive strings shouldn't reach the UI.
function looksLikeRawError(message: string): boolean {
  if (message.length > 140) return true
  if (/^[a-z0-9_]+$/i.test(message) && !message.includes(' ')) return true
  if (message.includes('Error:')) return true
  if (message.includes('\n')) return true
  return false
}

/** The server writes its messages in English, so they may only be shown in it. */
function mayShowServerMessage(): boolean {
  return currentLocale() === DEFAULT_LOCALE
}

export function translateBackendError(
  err: unknown,
  fallback?: string,
  /** Per-surface overrides, e.g. reauthMessages() inside Settings. */
  overrides?: Readonly<Record<string, string>>,
): string {
  const errors = staticMessages().errors
  const generic = fallback ?? errors.generic

  if (err instanceof ApiError) {
    const override = overrides?.[err.code]
    if (override) return override

    const mapped = friendlyByCode(err.code)
    if (mapped) return mapped

    if (err.status >= 500) return errors.server
    if (err.status === 401 || err.status === 403) return errors.signInAgain
    if (err.status === 404) return errors.notFound

    if (err.message && !looksLikeRawError(err.message) && mayShowServerMessage()) {
      return err.message
    }
    return generic
  }

  // Browser fetch surfaces network failures as TypeError ("Failed to fetch").
  if (err instanceof TypeError) return errors.network

  if (err instanceof Error && err.message && !looksLikeRawError(err.message)) {
    // A client-thrown Error is written by this codebase, not the server, so it
    // is already whatever language the throwing site used. Shown as-is.
    return err.message
  }

  return generic
}

export type { ByCode }
