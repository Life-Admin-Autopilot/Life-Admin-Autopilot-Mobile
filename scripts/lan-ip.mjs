#!/usr/bin/env node
// Prints this machine's LAN IP — the address a phone on the same network uses
// to reach `next dev` (:3000) and the API (:4000).
//
//   node scripts/lan-ip.mjs
//   import { lanIp } from './lan-ip.mjs'
//
// The bash twin, lan-ip.sh, resolves the default route with `route -n get` and
// `ipconfig getifaddr`, neither of which exists off macOS. This one is Node so
// it also runs on Windows and Linux, and — the part that actually matters —
// under cmd.exe, which is the shell `npm run` uses on Windows. A package.json
// script cannot call a .sh file or use $(...) there.
import os from 'node:os'
import { pathToFileURL } from 'node:url'

// Virtual adapters answer like real ones and are picked first as often as not.
// A Windows machine with WSL or Docker Desktop advertises a gateway on
// 172.x that no phone can reach, so the app builds cleanly and then cannot
// talk to anything — a failure that looks like the backend being down.
const VIRTUAL =
  /vethernet|hyper-v|virtualbox|vmware|vmnet|loopback|docker|veth|br-|virbr|wsl|tailscale|zerotier|bluetooth|npcap|^tun|^tap|^utun|^awdl|^llw|^bridge/i

// Private ranges in the order a home or campus network actually hands them out.
function rank(address) {
  if (address.startsWith('192.168.')) return 0
  if (address.startsWith('10.')) return 1
  const [a, b] = address.split('.').map(Number)
  if (a === 172 && b >= 16 && b <= 31) return 2
  return 3
}

export function lanIp() {
  const candidates = []

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue
    for (const entry of addresses ?? []) {
      // Node <18 reports family as 'IPv4', newer versions as 4. Accept both.
      const isV4 = entry.family === 'IPv4' || entry.family === 4
      if (!isV4 || entry.internal) continue
      candidates.push({ name, address: entry.address })
    }
  }

  if (candidates.length === 0) return null

  candidates.sort((x, y) => rank(x.address) - rank(y.address))
  return candidates[0].address
}

// Direct invocation prints the address; importing it does not. Compared as a
// file URL, not by string suffix: import.meta.url percent-encodes the space in
// "Grad Proj ITI", so a plain endsWith against argv[1] never matches.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const address = lanIp()
  if (!address) {
    console.error('No LAN address found — is this machine on a network?')
    process.exit(1)
  }
  console.log(address)
}
