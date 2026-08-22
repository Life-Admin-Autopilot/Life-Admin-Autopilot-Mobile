// `npm run app` — the whole stack, on the web and on a phone, in one command.
//
//   npm run app                    backend + site + the native target for this OS
//   npm run app -- --web           site only (no native, no IDE)
//   npm run app -- --ios           force iOS      (macOS only — Xcode)
//   npm run app -- --android       force Android  (any OS — Android Studio)
//   npm run app -- --skip-backend  the backend is already running elsewhere
//   npm run app -- --host 1.2.3.4  override LAN IP detection
//   npm run app -- --no-open       prepare everything, don't launch the IDE
//
// macOS → iOS/Xcode, everything else → Android/Android Studio, because iOS
// builds require Xcode and Xcode requires macOS. Android works on both.
//
// The one non-obvious thing this exists to get right: EVERY leg is addressed by
// LAN IP, never localhost. A phone resolves localhost to itself, so a stack that
// works perfectly in the Simulator (which shares the Mac's network stack) fails
// on a real device with nothing but a spinner. So the dev server binds 0.0.0.0,
// the backend binds [::], NEXT_PUBLIC_API_URL is the LAN IP, and the CORS
// allowlist carries the LAN origin — all derived from one detected address.
//
// See docs/CAPACITOR.md for the pipeline this automates.

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveLanIp } from './app/lan-ip.mjs'
import { checkCors, resolveBackendPort, startBackend } from './app/backend.mjs'
import { openIde, prepareNative } from './app/native.mjs'
import { installShutdown, start, waitForHttp } from './app/proc.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEB_PORT = 3000

// Piped output (CI logs, `| tee`) gets no escape codes.
const colour = (code) => (process.stdout.isTTY ? `\x1b[${code}m` : '')

const BOLD = colour(1)
const DIM = colour(2)
const GREEN = colour(32)
const YELLOW = colour(33)
const RESET = colour(0)

const options = parseArgs(process.argv.slice(2))

main().catch((error) => {
  console.error(`\n✗ ${error.message}\n`)
  process.exit(1)
})

async function main() {
  installShutdown()

  const lanIp = options.host ?? (await resolveLanIp())
  const backendPort = await resolveBackendPort(REPO_ROOT)

  const siteUrl = `http://${lanIp}:${WEB_PORT}`
  const apiUrl = `http://${lanIp}:${backendPort}`
  const platform = resolvePlatform()

  banner({ lanIp, siteUrl, apiUrl, platform })

  // --- 1. backend ----------------------------------------------------------
  if (options.skipBackend) {
    step('Backend', 'skipped (--skip-backend)')
  } else {
    step('Backend', `starting .NET on :${backendPort}`)
    const backend = await startBackend({
      repoRoot: REPO_ROOT,
      lanIp,
      port: backendPort,
      // capacitor://localhost is the webview's origin for a bundled build;
      // the LAN origin is what it becomes under live-reload. Both, so the same
      // backend serves either without a restart.
      corsOrigins: [siteUrl, `http://localhost:${WEB_PORT}`, 'capacitor://localhost', 'http://localhost'],
    })
    ok(`reachable at ${apiUrl}/health${backend.note ? ` (${backend.note})` : ''}`)

    // The allowlist is read once at startup, so a backend that was already
    // running predates this LAN origin and cannot be told about it — the only
    // fix is a restart. Worth a loud warning: on a phone this fails as a bare
    // spinner, with no console to read the CORS error in.
    const corsOk = await checkCors({ lanIp, port: backendPort, origin: siteUrl })
    if (corsOk) {
      ok(`CORS accepts ${siteUrl}`)
    } else {
      warn(`CORS does NOT accept ${siteUrl} — every request from the phone will fail.`)
      warn(
        backend.started
          ? `The backend at ${backend.dir} ignored EXTRA_CORS_ORIGINS. Add ${siteUrl} to its allowlist.`
          // Not stack.sh: backend.mjs deliberately prefers up.sh and only falls
          // back to stack.sh on macOS, so naming stack.sh here sent everyone
          // else to a script that cannot run on their machine — while the
          // backend they actually need to restart was started by up.sh.
          : `That backend was already running, so it predates this origin. Stop it (Ctrl+C where ${backend.dir}/tools/dev/up.sh is running) and run npm run app again.`,
      )
    }
  }

  // --- 2. site -------------------------------------------------------------
  // -H 0.0.0.0 so the phone can load the dev server at all. NEXT_PUBLIC_API_URL
  // is passed as a real env var, which Next prefers over .env files — so the
  // phone gets the LAN backend without editing (or dirtying) .env.local.
  step('Site', `starting next dev on :${WEB_PORT}`)
  // NEXT_DEV_ALLOWED_ORIGINS: next.config.ts feeds this to `allowedDevOrigins`.
  // Without the LAN IP there, Next blocks the dev-asset requests that
  // client-side navigation depends on, and the app hangs on its boot splash —
  // see the comment in next.config.ts.
  const site = start('npm', ['run', 'dev', '--', '-H', '0.0.0.0', '-p', String(WEB_PORT)], {
    cwd: REPO_ROOT,
    env: { NEXT_PUBLIC_API_URL: apiUrl, NEXT_DEV_ALLOWED_ORIGINS: lanIp },
  })
  await waitForHttp(siteUrl, { timeoutMs: 120_000, child: site })
  ok(`serving ${siteUrl} (and http://localhost:${WEB_PORT})`)

  if (platform === 'web') return summary({ siteUrl, apiUrl, platform })

  // --- 3. phone ------------------------------------------------------------
  step('Phone', `syncing the ${platform} shell with live-reload → ${siteUrl}`)
  await prepareNative({ repoRoot: REPO_ROOT, platform, liveReloadUrl: siteUrl, apiUrl })
  ok('native project synced')

  if (options.open) {
    step('IDE', `opening ${platform === 'ios' ? 'Xcode' : 'Android Studio'}`)
    await openIde({ repoRoot: REPO_ROOT, platform })
  }

  summary({ siteUrl, apiUrl, platform })
}

function resolvePlatform() {
  if (options.platform) return options.platform

  if (process.platform === 'darwin') return 'ios'
  return 'android'
}

function parseArgs(argv) {
  const parsed = { platform: null, host: null, skipBackend: false, open: true }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--ios':
      case '--android':
      case '--web':
        parsed.platform = arg.slice(2)
        break
      case '--host':
        parsed.host = argv[++i]
        if (!parsed.host) {
          console.error('✗ --host needs an address, e.g. --host 192.168.1.12\n')
          process.exit(1)
        }
        break
      case '--skip-backend':
        parsed.skipBackend = true
        break
      case '--no-open':
        parsed.open = false
        break
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
      // eslint-disable-next-line no-fallthrough
      default:
        console.error(`Unknown argument: ${arg}\n`)
        printHelp()
        process.exit(1)
    }
  }

  if (parsed.platform === 'ios' && process.platform !== 'darwin') {
    console.error('✗ --ios needs macOS: iOS builds require Xcode. Use --android.\n')
    process.exit(1)
  }

  return parsed
}

function printHelp() {
  console.log(`npm run app — backend + site + phone, one command

  --web             site only, no native shell
  --ios             force iOS (macOS only)
  --android         force Android
  --skip-backend    don't start the .NET backend
  --host <ip>       override LAN IP detection
  --no-open         prepare everything, don't launch the IDE
`)
}

// --- output ----------------------------------------------------------------

function banner({ lanIp, siteUrl, apiUrl, platform }) {
  const target = platform === 'web' ? 'web only' : platform === 'ios' ? 'iOS / Xcode' : 'Android / Android Studio'
  console.log(`\n${BOLD}Kitto${RESET} ${DIM}— ${target}${RESET}`)
  console.log(`${DIM}LAN IP ${lanIp}   site ${siteUrl}   api ${apiUrl}${RESET}`)
}

function step(label, message) {
  console.log(`\n${BOLD}${label}${RESET} ${DIM}· ${message}${RESET}`)
}

function ok(message) {
  console.log(`  ${GREEN}✓${RESET} ${message}`)
}

function warn(message) {
  console.log(`  ${YELLOW}!${RESET} ${message}`)
}

function summary({ siteUrl, apiUrl, platform }) {
  console.log(`\n${BOLD}Ready${RESET}`)
  console.log(`  site      ${siteUrl}`)
  console.log(`  backend   ${apiUrl}`)

  if (platform !== 'web') {
    console.log(`  phone     press ${BOLD}▶${RESET} in ${platform === 'ios' ? 'Xcode' : 'Android Studio'} — it live-reloads from the site`)
    console.log(`${DIM}            the phone must be on the same Wi-Fi as this machine${RESET}`)
  }

  console.log(`\n${DIM}Ctrl-C stops the dev server.${RESET}`)
}
