// Why a getUserMedia({ audio }) call could not produce a recorder, in terms the
// UI can act on. Split out from useVoiceRecorder so the classification is
// testable on its own and the hook stays about the recording lifecycle.
//
// The distinction that matters most here is `unsupported` vs `denied`. Telling
// someone their mic is "blocked" sends them to Settings → Privacy, and when the
// real cause is a non-secure origin they find a correctly-granted permission
// and no way forward. See `isSecureContext` below.

import type { Translate } from '@/lib/i18n/translate'

export type MicFailure = 'unsupported' | 'insecure-context' | 'denied' | 'no-device' | 'unknown'

/** Scoped to the `lib` namespace — callers pass `useTranslations('lib')`. */
export type MicFailureKey =
  | 'mic.denied'
  | 'mic.noDevice'
  | 'mic.insecureContext'
  | 'mic.unsupported'
  | 'mic.unknown'

/**
 * True when the page can reach `navigator.mediaDevices` at all.
 *
 * WebKit only exposes mediaDevices in a secure context. A Capacitor prod build
 * serves from `capacitor://localhost`, and `localhost` is trustworthy, so that
 * is fine. A live-reload dev build pointed at `http://<LAN-IP>:3000` is NOT —
 * mediaDevices is `undefined` there and the mic can never work, no matter what
 * the user grants. Use http://localhost:3000 on the Simulator, or https / a
 * bundled build on a real device.
 */
export function isMicApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
}

export function classifyMicFailure(err: unknown): MicFailure {
  if (!isMicApiAvailable()) {
    // A non-secure origin is the overwhelmingly common reason the API is
    // missing; genuinely ancient engines are the rest.
    return typeof window !== 'undefined' && !window.isSecureContext ? 'insecure-context' : 'unsupported'
  }
  if (typeof MediaRecorder === 'undefined') return 'unsupported'

  const name = err instanceof Error ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-device'
  return 'unknown'
}

export function micFailureMessage(
  failure: MicFailure,
  appName: string,
  t: Translate<MicFailureKey>,
): string {
  switch (failure) {
    case 'denied':
      return t('mic.denied', { app: appName })
    case 'no-device':
      return t('mic.noDevice')
    case 'insecure-context':
      // Dev-only in practice — a shipped build is always a secure origin.
      return t('mic.insecureContext')
    case 'unsupported':
      return t('mic.unsupported')
    default:
      return t('mic.unknown')
  }
}
