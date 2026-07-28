// Why a getUserMedia({ audio }) call could not produce a recorder, in terms the
// UI can act on. Split out from useVoiceRecorder so the classification is
// testable on its own and the hook stays about the recording lifecycle.
//
// The distinction that matters most here is `unsupported` vs `denied`. Telling
// someone their mic is "blocked" sends them to Settings → Privacy, and when the
// real cause is a non-secure origin they find a correctly-granted permission
// and no way forward. See `isSecureContext` below.

export type MicFailure = 'unsupported' | 'insecure-context' | 'denied' | 'no-device' | 'unknown'

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

export function micFailureMessage(failure: MicFailure, appName: string): string {
  switch (failure) {
    case 'denied':
      return `${appName} needs microphone access. Enable it in Settings → Privacy & Security → Microphone.`
    case 'no-device':
      return 'No microphone found. Connect one and try again.'
    case 'insecure-context':
      // Dev-only in practice — a shipped build is always a secure origin.
      return 'Voice needs a secure connection. This dev build is served over plain http, so the browser blocks the microphone.'
    case 'unsupported':
      return 'This device or browser cannot record audio.'
    default:
      return 'Could not start recording. Try again.'
  }
}
