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

/**
 * Expand any IPv6 form — `::` compression, a trailing dotted quad — into its
 * eight 16-bit groups. Returns null for anything unparseable, which callers
 * treat as "no embedded v4" rather than as safe.
 */
function expandIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0] ?? ''

  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s)
  if (dotted?.[1]) {
    const o = dotted[1].split('.').map(Number)
    if (o.some((n) => n > 255)) return null
    s =
      s.slice(0, dotted.index) +
      (((o[0] as number) << 8) | (o[1] as number)).toString(16) +
      ':' +
      (((o[2] as number) << 8) | (o[3] as number)).toString(16)
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? (halves[0] as string).split(':') : []
  const tail = halves.length === 2 && halves[1] ? (halves[1] as string).split(':') : []
  if (halves.length === 1 && head.length !== 8) return null

  const fill = 8 - head.length - tail.length
  if (fill < 0) return null
  const groups = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...tail]
  if (groups.length !== 8) return null

  const out = groups.map((g) => (g === '' ? 0 : parseInt(g, 16)))
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : out
}

/**
 * Every IPv4 address an IPv6 address can carry.
 *
 * Unwrapping ONLY `::ffff:` — which is what this did before — leaves three other
 * transition formats that also embed IPv4, so `64:ff9b::a9fe:a9fe` is
 * 169.254.169.254 (the cloud metadata endpoint) in an IPv6 costume and the guard
 * waved it through. Each embedded address is put through the v4 rules.
 */
function embeddedIpv4(ip: string): string[] {
  const g = expandIpv6(ip)
  if (!g) return []
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`
  const found: string[] = []

  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible — deprecated but routable)
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0) {
    if (g[5] === 0xffff || g[5] === 0) found.push(v4(g[6] as number, g[7] as number))
  }
  // NAT64 well-known prefix, RFC 6052
  if (g[0] === 0x0064 && g[1] === 0xff9b && !g[2] && !g[3] && !g[4] && !g[5]) {
    found.push(v4(g[6] as number, g[7] as number))
  }
  // 6to4, RFC 3056 — the IPv4 sits in groups 1..2
  if (g[0] === 0x2002) found.push(v4(g[1] as number, g[2] as number))
  // Teredo, RFC 4380 — client IPv4 is the last 32 bits, XOR'd with all-ones
  if (g[0] === 0x2001 && g[1] === 0x0000) {
    found.push(v4(~(g[6] as number) & 0xffff, ~(g[7] as number) & 0xffff))
  }

  return found
}

function ipv6IsPrivate(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true // unspecified, loopback

  // Any transition format that carries an IPv4 must be unwrapped, or it bypasses
  // the v4 rules entirely. See embeddedIpv4 — `::ffff:` alone is not enough.
  for (const v4 of embeddedIpv4(lower)) {
    if (ipv4IsPrivate(v4)) return true
  }

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
