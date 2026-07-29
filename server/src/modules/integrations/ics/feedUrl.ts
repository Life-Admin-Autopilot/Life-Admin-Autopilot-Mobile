// Normalise and vet a user-supplied calendar feed URL before the server fetches
// it.
//
// This is a server-side request to an address the USER chose, which is the
// textbook SSRF setup: without a guard, "subscribe to my school calendar"
// becomes a way to make Kitto's backend GET http://169.254.169.254/ (cloud
// instance metadata, i.e. credentials), or reach anything else inside the
// deployment's network that is not exposed publicly.
//
// The guard is deliberately conservative. A feed we wrongly refuse is a support
// ticket; a feed we wrongly fetch can exfiltrate infrastructure credentials.
//
// Note what this file does NOT solve: DNS rebinding, where a hostname resolves
// to a public address here and a private one microseconds later when the socket
// actually opens. Closing that requires pinning the connection to the vetted IP,
// which Node's global fetch does not expose. The mitigation is to re-vet every
// redirect hop (see fetchFeed.ts) and to run the fetcher without ambient network
// credentials. Flagged rather than hidden.

import { lookup } from 'node:dns/promises'

export class UnsafeFeedUrlError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'UnsafeFeedUrlError'
  }
}

/**
 * webcal: is not a real scheme — it is https: wearing a hat so that clicking a
 * link opens a calendar app. Every publisher emits it; every consumer rewrites
 * it.
 */
export function normalizeFeedUrl(input: string): URL {
  const trimmed = input.trim()

  // The swap has to happen on the STRING, before parsing. webcal: is a
  // non-special scheme per the WHATWG URL spec, and assigning `.protocol` to
  // cross the special/non-special boundary is silently ignored — the URL would
  // stay webcal: and then fail the check below with a confusing message.
  const rewritten = /^webcal:\/\//i.test(trimmed)
    ? `https://${trimmed.slice('webcal://'.length)}`
    : trimmed

  let parsed: URL
  try {
    parsed = new URL(rewritten)
  } catch {
    throw new UnsafeFeedUrlError('That is not a valid URL.')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UnsafeFeedUrlError('Calendar feeds must use https.')
  }

  // Credentials in the URL are a redirect-laundering trick and never legitimate
  // on a public feed.
  if (parsed.username || parsed.password) {
    throw new UnsafeFeedUrlError('Calendar feed URLs must not contain credentials.')
  }

  return parsed
}

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true
  const [a = 0, b = 0] = parts

  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved
  return false
}

function ipv6IsPrivate(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true // unspecified, loopback

  // IPv4-mapped (::ffff:10.0.0.1) must be unwrapped or it bypasses the v4 rules.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped?.[1]) return ipv4IsPrivate(mapped[1])

  const head = lower.split(':')[0] ?? ''
  if (/^f[cd]/.test(head)) return true // unique local
  if (/^fe[89ab]/.test(head)) return true // link-local
  return false
}

export function isPrivateAddress(ip: string, family: number): boolean {
  return family === 6 ? ipv6IsPrivate(ip) : ipv4IsPrivate(ip)
}

/**
 * Resolve the hostname and refuse anything that lands inside the deployment's
 * own network. Returns the vetted URL so callers cannot forget to use the
 * normalised form.
 */
export async function assertPublicFeedUrl(url: URL): Promise<URL> {
  let resolved: { address: string; family: number }[]
  try {
    resolved = await lookup(url.hostname, { all: true })
  } catch {
    throw new UnsafeFeedUrlError('That address could not be resolved.')
  }

  if (resolved.length === 0) throw new UnsafeFeedUrlError('That address could not be resolved.')

  // ALL results must be public. A hostname with one public and one private A
  // record is an attack, not a misconfiguration.
  for (const { address, family } of resolved) {
    if (isPrivateAddress(address, family)) {
      throw new UnsafeFeedUrlError('That address is not publicly reachable.')
    }
  }

  return url
}

/** Normalise and vet in one step. The only entry point callers should use. */
export async function prepareFeedUrl(input: string): Promise<URL> {
  return assertPublicFeedUrl(normalizeFeedUrl(input))
}
