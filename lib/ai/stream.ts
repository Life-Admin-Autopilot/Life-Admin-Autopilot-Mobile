// AI chat SSE client. The /ai/ask and /ai/tools/confirm endpoints stream
// Server-Sent Events; this module owns the parser so the rest of the app sees a
// typed async iterator of events. Mirrors the auth/refresh behavior in client.ts.
//
// Unlike v1 (React Native, which needs expo/fetch for a streaming body), the
// browser's native fetch already exposes `response.body` as a ReadableStream —
// so we read it directly. The 401 → /auth/refresh → retry dance is replicated
// here because the streaming body can't go through api() (which buffers JSON).

import { ApiError, refreshAccessToken } from '@/lib/api/client'
import { resolveApiBaseUrl } from '@/lib/api/baseUrl'
import { useSessionStore } from '@/lib/auth/sessionStore'
import type { AskEvent } from '@/lib/ai/types'

// Which entry path a turn came from. Every path in the product converges on one
// planning agent, and the agent handles the same sentence differently depending
// on how it arrived: typed text is a request, a dictated transcript is raw
// speech to be parsed, and document text was extracted from a scan. Omitted ⇒
// the server defaults to 'chat'.
export type AskMode = 'chat' | 'transcript' | 'document' | 'clarification'

export interface AskArgs {
  question: string
  timezone?: string
  mode?: AskMode
  signal?: AbortSignal
}

// Async iterator over the initial-turn SSE stream (POST /ai/ask).
export async function* askStream(args: AskArgs): AsyncGenerator<AskEvent> {
  yield* streamSse({
    url: `${resolveApiBaseUrl()}/ai/ask`,
    // `mode` is omitted rather than sent as 'chat' when absent, so the request
    // stays byte-identical to what shipped for every existing caller.
    body: { question: args.question, timezone: args.timezone, ...(args.mode ? { mode: args.mode } : {}) },
    signal: args.signal,
  })
}

// Confirm or decline a destructive tool call (POST /ai/tools/confirm/:callId).
// The server streams a continuation (tokens + any subsequent tool calls) so the
// system can pick up a multi-step plan interrupted by the confirmation gate.
export async function* confirmStream(
  callId: string,
  action: 'confirm' | 'decline',
  signal?: AbortSignal,
): AsyncGenerator<AskEvent> {
  yield* streamSse({
    // ENCODED, always. A call id is server-minted and has contained a '#',
    // which a browser treats as the start of a fragment — everything after it
    // never leaves the client, the server looks up a truncated id, and the
    // confirmation answers "This confirmation has expired." The server no
    // longer mints '#', but a client must not depend on the shape of an
    // opaque id it did not create.
    url: `${resolveApiBaseUrl()}/ai/tools/confirm/${encodeURIComponent(callId)}`,
    body: { action },
    signal,
  })
}

interface StreamSseArgs {
  url: string
  body: Record<string, unknown>
  signal?: AbortSignal
}

// Shared SSE consumer — POSTs a JSON body, parses Server-Sent Event frames from
// the response body, and yields typed AskEvents. Used by both askStream (initial
// turn) and confirmStream (post-confirmation continuation).
async function* streamSse(args: StreamSseArgs): AsyncGenerator<AskEvent> {
  // The SSE seam reads the access token directly — it can't go through api()
  // because it needs the raw streaming body — so it replicates api()'s one-shot
  // 401 → /auth/refresh → retry. Without it an expired access token surfaces as
  // a hard "Invalid or expired access token" error. The confirm flow is
  // especially prone: the user can pause on the "can't be undone" card long
  // enough for the token to lapse before tapping.
  const open = () => {
    const access = useSessionStore.getState().accessToken
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    }
    if (access) headers.Authorization = `Bearer ${access}`
    return fetch(args.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args.body),
      signal: args.signal,
    })
  }

  let res = await open()

  if (res.status === 401) {
    const refreshed = await refreshAccessToken()
    // Auth middleware rejects before the pending tool call is consumed, so
    // retrying the confirm with a fresh token is safe (no double-execute).
    if (refreshed) res = await open()
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let parsed: { error?: { code?: string; message?: string; details?: unknown } } = {}
    try {
      parsed = JSON.parse(text) as typeof parsed
    } catch {
      // not JSON
    }
    throw new ApiError(
      parsed.error?.code ?? 'http_error',
      parsed.error?.message ?? `HTTP ${res.status}`,
      res.status,
      parsed.error?.details,
    )
  }

  const body = res.body
  if (!body) throw new ApiError('no_body', 'AI stream returned no body.', 500)

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let blank: number
      while ((blank = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, blank)
        buffer = buffer.slice(blank + 2)
        const event = parseSseFrame(frame)
        if (event) yield event
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}

function parseSseFrame(frame: string): AskEvent | null {
  // Heartbeat comment lines start with `:`.
  if (frame.startsWith(':')) return null
  const lines = frame.split('\n')
  let data = ''
  for (const line of lines) {
    if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (data.length === 0) return null
  try {
    return JSON.parse(data) as AskEvent
  } catch {
    return null
  }
}
