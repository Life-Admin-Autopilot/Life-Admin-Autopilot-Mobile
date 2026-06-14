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
import { logger } from '@/lib/logger'
import { useSessionStore } from '@/lib/auth/sessionStore'

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

interface RefreshBody {
  tokens: { accessToken: string; refreshToken: string }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  authenticated?: boolean
}

let refreshPromise: Promise<boolean> | null = null

export async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    try {
      const refreshToken = useSessionStore.getState().refreshToken
      if (!refreshToken) return false

      const res = await fetch(`${resolveApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!res.ok) {
        await useSessionStore.getState().clear()
        return false
      }

      const data = (await res.json()) as RefreshBody
      await useSessionStore
        .getState()
        .setTokens(data.tokens.accessToken, data.tokens.refreshToken)
      return true
    } catch (err: unknown) {
      logger.warn('api:refresh-failed', err)
      return false
    } finally {
      refreshPromise = null
    }
  })()

  return refreshPromise
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
      err?.message ?? 'Something went wrong. Try again.',
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
      err?.message ?? 'Something went wrong. Try again.',
      res.status,
      err?.details,
    )
  }
  return data as T
}
