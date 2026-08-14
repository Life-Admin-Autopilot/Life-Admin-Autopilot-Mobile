// Fetch wrapper for the life-admin Express backend.
//
// Adds:
//   - Bearer access token from the session store
//   - One-shot 401 → /auth/refresh → retry, behind a mutex so two concurrent
//     401s don't both attempt to refresh
//   - Normalized ApiError shape so feature code can branch on `err.code`
//
// /auth/refresh is called via plain fetch — never through api() — to avoid a
// recursion loop on a failed refresh. Ports from v1 unchanged except the token
// source, which is the web session store (see lib/auth/sessionStore.ts).

import { resolveApiBaseUrl } from '@/lib/api/baseUrl'
import { staticMessages } from '@/lib/i18n/staticMessages'
import { logger } from '@/lib/logger'
import { refreshSession, useSessionStore } from '@/lib/auth/sessionStore'

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly details: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.details = details
  }
}

interface ErrorBody {
  error: { code: string; message: string; details?: unknown }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  authenticated?: boolean
}

// What an ApiError says when the server sent no message of its own.
//
// Read from the catalogue rather than taken as an argument: this is the
// transport layer, called from query functions with no component anywhere on
// the stack — the case lib/i18n/staticMessages.ts documents. Lookup only, no
// ICU, which is the constraint that file imposes.
//
// It is the same sentence translateBackendError falls back to, deliberately: an
// unmapped code reaches that function either way, and having the two disagree
// would mean the language the user sees depends on which of them ran.
function genericErrorMessage(): string {
  return staticMessages().errors.generic
}

/**
 * Rotate the session. Kept as a named export because the SSE seam calls it too.
 *
 * The implementation lives in the session store, which owns the tokens. It used
 * to live here as well — two independent rotations against a SINGLE-USE refresh
 * token, which is how a cold start with an expired access token could sign the
 * user out: boot hydration and the first component query presented the same
 * token, one won, and the loser read its 401 as "session dead" and wiped
 * storage.
 */
export async function refreshAccessToken(): Promise<boolean> {
  return refreshSession()
}

// Serialize a filter object into a querystring. `api()` takes the query baked
// into `path`, so every list caller would otherwise hand-roll this.
//
// Undefined/null/empty-string values are dropped rather than sent blank — the
// task list schema is `.strict()` and rejects an empty `?status=`, so a filter
// the user cleared must vanish from the URL entirely. Arrays join with commas
// to match the server's multi-value filters.
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      search.set(key, value.join(','))
    } else {
      search.set(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = true } = options

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (authenticated) {
      const access = useSessionStore.getState().accessToken
      if (access) headers.Authorization = `Bearer ${access}`
    }
    return fetch(`${resolveApiBaseUrl()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  }

  let res = await send()

  if (res.status === 401 && authenticated) {
    const refreshed = await refreshAccessToken()
    if (refreshed) {
      res = await send()
    }
  }

  if (res.status === 204) {
    return undefined as T
  }

  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error
    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? genericErrorMessage(),
      res.status,
      err?.details,
    )
  }
  return data as T
}

export interface ApiBinaryOptions {
  method?: 'POST' | 'PUT' | 'PATCH'
  contentType: string
  body: ArrayBuffer | Uint8Array | Blob
  headers?: Record<string, string>
  authenticated?: boolean
  signal?: AbortSignal
}

// Binary upload variant of api(). Shares the refresh mutex so a 401 during
// upload triggers the same one-shot refresh-and-retry the JSON path uses.
// Accepts an optional AbortSignal so callers (e.g. chat voice "Discard") can
// cancel an in-flight upload.
export async function apiBinary<T>(path: string, options: ApiBinaryOptions): Promise<T> {
  const {
    method = 'POST',
    contentType,
    body,
    headers: extraHeaders,
    authenticated = true,
    signal,
  } = options

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      ...(extraHeaders ?? {}),
    }
    if (authenticated) {
      const access = useSessionStore.getState().accessToken
      if (access) headers.Authorization = `Bearer ${access}`
    }
    return fetch(`${resolveApiBaseUrl()}${path}`, {
      method,
      headers,
      body: body as BodyInit,
      signal,
    })
  }

  let res = await send()
  if (res.status === 401 && authenticated) {
    const refreshed = await refreshAccessToken()
    if (refreshed) res = await send()
  }

  if (res.status === 204) return undefined as T

  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error
    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? genericErrorMessage(),
      res.status,
      err?.details,
    )
  }
  return data as T
}

// multipart/form-data variant of api(), for the endpoints that take an
// IFormFile rather than a JSON body (currently only /api/speech/transcribe).
// Shares the refresh mutex, so a 401 mid-upload gets the same one-shot
// refresh-and-retry.
//
// Note what is NOT set: Content-Type. The browser must write it itself so it
// can append the multipart boundary — setting it by hand produces a body the
// server cannot split.
export async function apiForm<T>(
  path: string,
  form: FormData,
  options: { method?: 'POST' | 'PUT' | 'PATCH'; authenticated?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const { method = 'POST', authenticated = true, signal } = options

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    if (authenticated) {
      const access = useSessionStore.getState().accessToken
      if (access) headers.Authorization = `Bearer ${access}`
    }
    return fetch(`${resolveApiBaseUrl()}${path}`, { method, headers, body: form, signal })
  }

  let res = await send()
  if (res.status === 401 && authenticated) {
    const refreshed = await refreshAccessToken()
    if (refreshed) res = await send()
  }

  if (res.status === 204) return undefined as T

  const data = (await res.json().catch(() => null)) as unknown
  if (!res.ok) {
    const err = (data as ErrorBody | null)?.error
    // The MVC controllers predate the kernel envelope and answer with their own
    // DTO, so the parsed body is carried through as `details` when there is no
    // `error` key to read — otherwise the caller has no way to see why it failed.
    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? genericErrorMessage(),
      res.status,
      err?.details ?? data,
    )
  }
  return data as T
}

// GET variant that returns a raw Blob instead of parsed JSON — for
// authenticated binary resources (e.g. viewing an original scanned
// document). Shares the same bearer-token + one-shot-401-refresh behavior as
// api()/apiBinary(); error bodies are still JSON so failures parse the same way.
export async function apiBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {}
    const access = useSessionStore.getState().accessToken
    if (access) headers.Authorization = `Bearer ${access}`
    return fetch(`${resolveApiBaseUrl()}${path}`, { headers, signal })
  }

  let res = await send()
  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    if (refreshed) res = await send()
  }

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as ErrorBody | null
    const err = data?.error
    throw new ApiError(
      err?.code ?? 'unknown_error',
      err?.message ?? genericErrorMessage(),
      res.status,
      err?.details,
    )
  }
  return res.blob()
}
