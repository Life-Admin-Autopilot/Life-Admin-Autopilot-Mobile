// This machine's LAN IP — the address a phone on the same Wi-Fi uses to reach
// `next dev` (:3000) and the backend (:5080).
//
// The cross-platform twin of scripts/lan-ip.sh, which `npm run app` needs
// because that script is bash and Windows is a supported target here.
//
// Picking "the" IPv4 is not obvious on a dev machine: VPN tunnels, Docker
// bridges, VirtualBox host-only adapters and iOS Simulator bridges all present
// non-internal IPv4 addresses, and choosing one of those silently produces an
// app that cannot reach anything. So: ask the OS which interface carries the
// default route, and only fall back to heuristics if that fails.

import { networkInterfaces } from 'node:os'
import { capture } from './proc.mjs'

// Interfaces that are real to the OS but useless to a phone: VPN tunnels,
// container/VM bridges, and the Simulator's own bridge.
const VIRTUAL_PREFIXES = ['utun', 'awdl', 'llw', 'bridge', 'vmnet', 'vboxnet', 'docker', 'veth']

// VirtualBox host-only lives here and answers to nothing else on the network.
const VIRTUAL_SUBNETS = ['192.168.56.']

export async function resolveLanIp() {
  const viaRoute = await defaultRouteAddress()
  if (viaRoute) return viaRoute

  const candidate = firstUsableInterface()
  if (candidate) return candidate

  throw new Error(
    'Could not determine this machine\'s LAN IP. Connect to Wi-Fi, or pass one explicitly: npm run app -- --host 192.168.1.12',
  )
}

/** Ask the OS which interface the default route uses, then read its IPv4. */
async function defaultRouteAddress() {
  if (process.platform === 'darwin') {
    const route = await capture('route', ['-n', 'get', 'default'])
    const iface = route.stdout.match(/interface:\s*(\S+)/)?.[1]
    if (!iface) return null

    const address = await capture('ipconfig', ['getifaddr', iface])
    return address.stdout.trim() || null
  }

  if (process.platform === 'linux') {
    const route = await capture('ip', ['route', 'get', '1.1.1.1'])
    return route.stdout.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null
  }

  // Windows: `route print` gives the default gateway's interface by IP, which
  // is directly the address we want — the third column of the 0.0.0.0 row.
  const route = await capture('route', ['print', '-4', '0.0.0.0'])
  const match = route.stdout.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+\S+\s+(\d+\.\d+\.\d+\.\d+)/m)
  return match?.[1] ?? null
}

function firstUsableInterface() {
  const entries = Object.entries(networkInterfaces())

  // Wi-Fi/Ethernet names first — on a laptop that is almost always the answer,
  // and it keeps a stray adapter from winning just by enumeration order.
  const ranked = entries.sort(([a], [b]) => rank(a) - rank(b))

  for (const [name, addresses] of ranked) {
    if (VIRTUAL_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix))) continue

    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue
      if (VIRTUAL_SUBNETS.some((subnet) => address.address.startsWith(subnet))) continue
      return address.address
    }
  }

  return null
}

function rank(name) {
  const lower = name.toLowerCase()
  if (lower.startsWith('en') || lower.includes('wi-fi') || lower.includes('wlan')) return 0
  if (lower.startsWith('eth') || lower.includes('ethernet')) return 1
  return 2
}
