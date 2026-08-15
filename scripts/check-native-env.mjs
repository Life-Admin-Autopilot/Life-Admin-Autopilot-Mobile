#!/usr/bin/env node
// Refuse a native build that would be born unable to reach the backend.
//
// NEXT_PUBLIC_API_URL is inlined at BUILD time, so a wrong value is baked into
// the APK and produces a spinner and a network error on the device — never a
// config error, and a long way from this step.
//
// The specific trap: dotenv-cli does not complain about a missing
// `.env.native-dev.local`. It leaves the variable unset, Next then falls back
// to `.env.local`, and that file says localhost:4000 because it is the file the
// BROWSER uses. On a phone, localhost is the phone. The build succeeds and the
// app is dead.
import { existsSync, readFileSync } from 'node:fs'

const FILE = '.env.native-dev.local'

if (!existsSync(FILE)) {
  console.error(`Missing ${FILE}\n`)
  console.error('A native build needs to know where YOUR backend is. Create it')
  console.error('with ONE of these lines:\n')
  console.error('  # Android emulator (10.0.2.2 is the emulator\'s host)')
  console.error('  NEXT_PUBLIC_API_URL=http://10.0.2.2:4000\n')
  console.error('  # Real phone on the same Wi-Fi — `npm run lan:ip` prints yours')
  console.error('  NEXT_PUBLIC_API_URL=http://192.168.x.x:4000\n')
  console.error('A real phone also needs that address in the backend\'s')
  console.error('Kernel__Cors__Origins, or every call is refused.')
  process.exit(1)
}

const value = readFileSync(FILE, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.match(/^NEXT_PUBLIC_API_URL\s*=\s*(.+)$/))
  .find(Boolean)?.[1]
  ?.trim()

if (!value) {
  console.error(`${FILE} has no NEXT_PUBLIC_API_URL line.`)
  process.exit(1)
}

if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(value)) {
  console.error(`${FILE} points at ${value}\n`)
  console.error('On a device, localhost is the DEVICE — not this machine. Use')
  console.error('10.0.2.2 for the Android emulator, or this machine\'s LAN')
  console.error('address for a real phone (`npm run lan:ip`).')
  process.exit(1)
}

console.log(`Native build will call ${value}`)
