// Turn a raw User-Agent string into something a person recognises.
//
// The signed-in-devices list exists so someone can answer one question: "is any
// of these not me?" A row reading
// `Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15…`
// cannot be answered; `iPhone · Safari` can. Deliberately coarse — the goal is
// recognition, not forensics, and a wrong-but-specific guess ("iPhone 14 Pro")
// would be worse than an honest broad one.
//
// Pure and dependency-free (AGENTS.md → lib/ is pure by default), so the whole
// ladder is unit-testable without a browser.

export interface DeviceDescription {
  /** e.g. "iPhone" — what it runs on. */
  platform: string
  /** e.g. "Safari" — what it runs in. Absent when nothing is recognisable. */
  browser?: string
  /** Display string, e.g. "iPhone · Safari". */
  label: string
  /** Emoji for the row's identity chip. */
  emoji: string
}

const UNKNOWN: DeviceDescription = {
  platform: 'Unknown device',
  label: 'Unknown device',
  emoji: '❓',
}

function platformOf(ua: string): { name: string; emoji: string } | null {
  // Order matters: iPadOS reports "Macintosh" in desktop mode, and Android
  // tablets say "Android" before they say "Linux".
  if (/\biPhone\b/i.test(ua)) return { name: 'iPhone', emoji: '📱' }
  if (/\biPad\b/i.test(ua)) return { name: 'iPad', emoji: '📱' }
  if (/\bAndroid\b/i.test(ua)) return { name: 'Android', emoji: '📱' }
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return { name: 'Mac', emoji: '💻' }
  if (/\bWindows\b/i.test(ua)) return { name: 'Windows', emoji: '💻' }
  if (/\bCrOS\b/i.test(ua)) return { name: 'Chromebook', emoji: '💻' }
  if (/\bLinux\b/i.test(ua)) return { name: 'Linux', emoji: '💻' }
  return null
}

function browserOf(ua: string): string | undefined {
  // Every one of these also claims to be "Safari" and most claim "Chrome", so
  // the most specific brand has to be tested first or everything reads Chrome.
  if (/\bEdgA?\//i.test(ua)) return 'Edge'
  if (/\bOPR\/|\bOpera\b/i.test(ua)) return 'Opera'
  if (/\bFirefox\/|\bFxiOS\//i.test(ua)) return 'Firefox'
  if (/\bCriOS\//i.test(ua)) return 'Chrome'
  if (/\bChrome\//i.test(ua)) return 'Chrome'
  if (/\bSafari\//i.test(ua)) return 'Safari'
  return undefined
}

export function describeUserAgent(ua: string | undefined): DeviceDescription {
  if (!ua?.trim()) return UNKNOWN

  const platform = platformOf(ua)
  if (!platform) return UNKNOWN

  // The Capacitor shell is a WKWebView with no browser brand of its own, so
  // naming it "Safari" would be a lie — it is the Kitto app itself.
  const isNativeShell = /\bKitto\b/i.test(ua)
  const browser = isNativeShell ? 'Kitto app' : browserOf(ua)

  return {
    platform: platform.name,
    browser,
    label: browser ? `${platform.name} · ${browser}` : platform.name,
    emoji: platform.emoji,
  }
}
