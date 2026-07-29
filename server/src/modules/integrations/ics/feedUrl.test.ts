import { describe, expect, it } from 'vitest'
import { UnsafeFeedUrlError, isPrivateAddress, normalizeFeedUrl } from './feedUrl'

describe('normalizeFeedUrl', () => {
  it('rewrites webcal to https', () => {
    // Every publisher emits webcal:; it is https: wearing a hat.
    expect(normalizeFeedUrl('webcal://school.example/terms.ics').toString()).toBe(
      'https://school.example/terms.ics',
    )
  })

  it('accepts plain https', () => {
    expect(normalizeFeedUrl('https://council.example/bins.ics').protocol).toBe('https:')
  })

  it('rejects schemes that are not http(s)', () => {
    // file: would read the server's own disk; gopher:/ftp: are classic SSRF
    // smuggling vectors.
    for (const bad of [
      'file:///etc/passwd',
      'ftp://example.com/a.ics',
      'gopher://example.com/',
      'data:text/calendar,BEGIN:VCALENDAR',
    ]) {
      expect(() => normalizeFeedUrl(bad)).toThrow(UnsafeFeedUrlError)
    }
  })

  it('rejects embedded credentials', () => {
    expect(() => normalizeFeedUrl('https://user:pass@example.com/a.ics')).toThrow(
      UnsafeFeedUrlError,
    )
  })

  it('rejects unparseable input', () => {
    for (const bad of ['', 'not a url', 'https://']) {
      expect(() => normalizeFeedUrl(bad)).toThrow(UnsafeFeedUrlError)
    }
  })
})

describe('isPrivateAddress — IPv4', () => {
  it('blocks the cloud metadata endpoint', () => {
    // The single most valuable SSRF target: instance credentials.
    expect(isPrivateAddress('169.254.169.254', 4)).toBe(true)
  })

  it('blocks loopback and RFC1918 ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '127.255.255.255',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '0.0.0.0',
    ]) {
      expect(isPrivateAddress(ip, 4)).toBe(true)
    }
  })

  it('blocks CGNAT, benchmarking, multicast and reserved space', () => {
    for (const ip of ['100.64.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255']) {
      expect(isPrivateAddress(ip, 4)).toBe(true)
    }
  })

  it('allows genuinely public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '193.168.0.1']) {
      expect(isPrivateAddress(ip, 4)).toBe(false)
    }
  })

  it('does not let a near-miss through', () => {
    // 172.16/12 has fiddly bounds — 172.15 and 172.32 are public, 172.16-31 are
    // not. Off-by-one here is a real hole.
    expect(isPrivateAddress('172.15.255.255', 4)).toBe(false)
    expect(isPrivateAddress('172.16.0.0', 4)).toBe(true)
    expect(isPrivateAddress('172.31.255.255', 4)).toBe(true)
    expect(isPrivateAddress('172.32.0.0', 4)).toBe(false)
  })
})

describe('isPrivateAddress — IPv6', () => {
  it('blocks loopback, unspecified, ULA and link-local', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1']) {
      expect(isPrivateAddress(ip, 6)).toBe(true)
    }
  })

  it('unwraps IPv4-mapped addresses instead of waving them through', () => {
    // ::ffff:169.254.169.254 reaches the metadata endpoint. Treating it as an
    // opaque v6 string would bypass every v4 rule above.
    expect(isPrivateAddress('::ffff:169.254.169.254', 6)).toBe(true)
    expect(isPrivateAddress('::ffff:10.0.0.1', 6)).toBe(true)
    expect(isPrivateAddress('::ffff:8.8.8.8', 6)).toBe(false)
  })

  it('allows public IPv6', () => {
    expect(isPrivateAddress('2606:4700:4700::1111', 6)).toBe(false)
  })
})
