// Typed public env. Reads NEXT_PUBLIC_* at module load. A missing value must
// NOT throw at module scope (that would crash the bundle before any UI mounts);
// instead we capture the failure as `envError` so a config-error screen can
// show a friendly message. This module stays pure (no react/I-O).
//
// NOTE: Next inlines `process.env.NEXT_PUBLIC_*` at build time, so the literal
// `process.env.NEXT_PUBLIC_API_URL` reference below is required — it can't be
// read dynamically.

interface PublicEnv {
  apiUrl: string
  /** Product name shown in chrome, the wordmark, and the document title. */
  appName: string
  /**
   * Dev-only on-device FPS overlay (components/dev/FpsMeter.tsx). Lives in the
   * native-dev profile only, so `cap:sync:prod` (which reads .env.production)
   * can never ship it — same mechanism that keeps the LAN IP out of prod.
   */
  showFps: boolean
}

const API_URL_HELP =
  'Copy .env.example to .env.local and set NEXT_PUBLIC_API_URL to the backend (e.g. http://localhost:4000).'

// Unlike apiUrl, a missing app name is not a broken configuration — it is a
// branding default. It falls back rather than raising envError.
const DEFAULT_APP_NAME = 'Kitto'

function read(value: string | undefined): string | null {
  if (!value || value.trim().length === 0) return null
  return value.replace(/\/$/, '')
}

const apiUrl = read(process.env.NEXT_PUBLIC_API_URL)
const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || DEFAULT_APP_NAME

// Non-null when configuration is incomplete. UI reads this to render a friendly
// config-error screen instead of surfacing a cryptic failure later.
export const envError: string | null =
  apiUrl === null ? `Missing NEXT_PUBLIC_API_URL. ${API_URL_HELP}` : null

// `apiUrl` falls back to '' when unconfigured so consumers stay strongly typed.
// Check `envError` before relying on it for a real request.
export const env: PublicEnv = {
  apiUrl: apiUrl ?? '',
  appName,
  showFps: process.env.NEXT_PUBLIC_SHOW_FPS === '1',
}
