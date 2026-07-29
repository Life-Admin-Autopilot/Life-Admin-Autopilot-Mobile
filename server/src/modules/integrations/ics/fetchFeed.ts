// Fetch a calendar feed, cheaply and safely.
//
// ICS has no push mechanism — there is no watch channel and no webhook anywhere
// in RFC 5545, so polling is the only option. What makes that affordable is the
// conditional GET: we send back the ETag or Last-Modified the publisher gave us
// last time, and a feed that has not changed answers 304 with an empty body. A
// school term feed changes perhaps three times a year, so almost every poll
// costs one round trip and no parsing, no AI, and no writes.
//
// Two failure modes are handled explicitly because both are silent otherwise:
//
//   - A feed that 404s or moves. Publishers retire URLs constantly. We surface
//     'gone' so the UI can tell the user their feed stopped, rather than showing
//     stale events forever with no indication they are frozen.
//   - A feed that returns HTML. An expired or auth-gated feed URL commonly
//     answers 200 with a login page. Parsed as ICS that yields zero events,
//     which is indistinguishable from "term has no dates" — so every reminder
//     silently disappears. We check the payload actually looks like iCalendar.

import { UnsafeFeedUrlError, assertPublicFeedUrl, normalizeFeedUrl } from './feedUrl'

/** Publishers' cache validators, stored per feed and replayed on the next poll. */
export interface FeedCacheState {
  etag?: string
  lastModified?: string
}

export type FetchFeedResult =
  | { status: 'unchanged' }
  | { status: 'ok'; body: string; etag?: string; lastModified?: string }
  | { status: 'gone'; reason: string }
  | { status: 'error'; reason: string }

/** A term of school events is tens of KB. A megabyte is already anomalous. */
export const MAX_FEED_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

/**
 * A 200 that is not iCalendar is almost always a login or error page. Checking
 * the body rather than the Content-Type header on purpose: plenty of councils
 * serve valid .ics as text/plain or application/octet-stream, so the header is
 * too unreliable to gate on, while the BEGIN:VCALENDAR sentinel is mandatory.
 */
export function looksLikeICalendar(body: string): boolean {
  return /BEGIN:VCALENDAR/i.test(body.slice(0, 2048))
}

/** Read a response body with a hard byte ceiling, so a huge feed cannot OOM us. */
async function readCapped(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_FEED_BYTES) return null

  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      // Content-Length is a hint, not a promise — enforce while reading too.
      if (total > MAX_FEED_BYTES) return null
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Conditional GET with redirect re-vetting.
 *
 * Redirects are followed manually rather than by fetch, because a publisher URL
 * that passes the SSRF check can still redirect into private space — and
 * `redirect: 'follow'` would do that for us with no opportunity to look. Each
 * hop is re-normalised and re-resolved before we chase it.
 */
export async function fetchFeed(
  rawUrl: string,
  cache: FeedCacheState = {},
): Promise<FetchFeedResult> {
  let current: URL
  try {
    current = await assertPublicFeedUrl(normalizeFeedUrl(rawUrl))
  } catch (error: unknown) {
    const reason = error instanceof UnsafeFeedUrlError ? error.message : 'That address is unusable.'
    return { status: 'error', reason }
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const headers: Record<string, string> = {
      accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
      // Some council endpoints 403 an absent UA. Identifying honestly also gives
      // a publisher someone to contact if our polling ever bothers them.
      'user-agent': 'Kitto/1.0 (calendar feed subscriber)',
    }
    if (cache.etag) headers['if-none-match'] = cache.etag
    if (cache.lastModified) headers['if-modified-since'] = cache.lastModified

    let response: Response
    try {
      response = await fetch(current, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (error: unknown) {
      const reason =
        error instanceof Error && error.name === 'TimeoutError'
          ? 'That feed took too long to respond.'
          : 'That feed could not be reached.'
      return { status: 'error', reason }
    }

    if (response.status === 304) return { status: 'unchanged' }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { status: 'error', reason: 'That feed sent an invalid redirect.' }
      try {
        // Resolve relative Locations against the current hop, then re-vet.
        current = await assertPublicFeedUrl(normalizeFeedUrl(new URL(location, current).toString()))
      } catch (error: unknown) {
        const reason =
          error instanceof UnsafeFeedUrlError ? error.message : 'That redirect is unusable.'
        return { status: 'error', reason }
      }
      continue
    }

    if (response.status === 404 || response.status === 410) {
      return { status: 'gone', reason: 'That feed no longer exists.' }
    }

    if (!response.ok) {
      return { status: 'error', reason: `That feed returned ${response.status}.` }
    }

    const body = await readCapped(response)
    if (body === null) return { status: 'error', reason: 'That feed is too large.' }

    if (!looksLikeICalendar(body)) {
      // Very likely a login or error page served with a 200.
      return { status: 'error', reason: 'That address did not return a calendar.' }
    }

    return {
      status: 'ok',
      body,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    }
  }

  return { status: 'error', reason: 'That feed redirected too many times.' }
}
