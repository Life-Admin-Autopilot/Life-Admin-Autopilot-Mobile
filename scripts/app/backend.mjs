// Brings up the .NET backend for `npm run app` and proves the phone can reach it.
//
// Two things make this more than "spawn dotnet run":
//
// 1. BINDING. A backend on 127.0.0.1 is invisible to a phone. The .NET stack
//    binds `http://[::]:PORT` (dual-stack, all interfaces) — so the check that
//    matters is a probe of http://<LAN-IP>:PORT/health, not localhost.
//
// 2. CORS. Under Capacitor live-reload the webview loads the whole app from
//    http://<LAN-IP>:3000, so THAT is the Origin the backend sees — not
//    `capacitor://localhost`. The allowlist is read once at startup, so the LAN
//    origin has to be injected before the process starts or every request fails
//    with an opaque network error in the webview.
//
// On macOS this delegates to the backend repo's own tools/dev/stack.sh, which
// also brings up the isolated Mongo (:27018) and Langflow (:7860) the AI surface
// needs. That script is bash, so other platforms get a direct `dotnet run` with
// the equivalent environment and an explicit warning about what is NOT started.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { capture, isUp, onShutdown, run, start, waitForHttp } from './proc.mjs'

const DEFAULT_PORT = 5080

/** Sibling checkout by default; override for a non-standard layout. */
export function backendDir(repoRoot) {
  return process.env.KITTO_BACKEND_DIR
    ? resolve(process.env.KITTO_BACKEND_DIR)
    : resolve(repoRoot, '..', 'Life-Admin-Autopilot-Backend')
}

/**
 * The port the frontend is already configured to call, so `npm run app` follows
 * .env.local rather than imposing a second source of truth.
 */
export async function resolveBackendPort(repoRoot) {
  for (const file of ['.env.local', '.env']) {
    const url = await readEnv(join(repoRoot, file), 'NEXT_PUBLIC_API_URL')
    const port = url && Number(new URL(url).port)
    if (port) return port
  }
  return DEFAULT_PORT
}

export async function startBackend({ repoRoot, lanIp, port, corsOrigins }) {
  const dir = backendDir(repoRoot)
  const lanHealth = `http://${lanIp}:${port}/health`

  if (await isUp(lanHealth)) {
    return { started: false, dir, note: 'already running — left alone' }
  }

  if (!existsSync(dir)) {
    throw new Error(
      `No .NET backend at ${dir}.\n` +
        '  Clone Life-Admin-Autopilot-Backend next to this repo, set KITTO_BACKEND_DIR,\n' +
        '  or skip it with: npm run app -- --skip-backend',
    )
  }

  // up.sh over stack.sh, deliberately. stack.sh launches Homebrew's mongod from
  // a hard-coded /opt/homebrew path and expects a sibling `Steward` checkout, so
  // it only ever ran on one macOS machine — a teammate's clone is named after
  // the repo, not `Steward`. up.sh runs anywhere with Docker and the .NET SDK,
  // Git Bash included, and its own header calls it stack.sh's replacement.
  const upScript = join(dir, 'tools/dev/up.sh')
  const stackScript = join(dir, 'tools/dev/stack.sh')
  const env = {
    EXTRA_CORS_ORIGINS: corsOrigins.join(','),
    // Pin the port to whatever the frontend is configured to call, so the two
    // cannot drift: up.sh defaults to 4000, stack.sh hard-codes 5080, and a
    // mismatch is a spinner on the phone rather than an error anywhere.
    ASPNETCORE_URLS: `http://[::]:${port}`,
  }

  // up.sh is preferred but not unconditional: it exits 1 without a backend .env,
  // and it brings the dependencies up with Docker. A machine that has neither
  // would just fail — where stack.sh, on the Mac this was built on, still works
  // off Homebrew's mongod. So each launcher is used where it can actually run.
  if (existsSync(upScript) && existsSync(join(dir, '.env')) && (await hasDocker()) && (await hasBash())) {
    // up.sh execs dotnet in the foreground, so this is a tracked child that
    // Ctrl-C tears down with the rest.
    start('bash', [upScript], { cwd: dir, env })
  } else if (process.platform !== 'win32' && existsSync(stackScript)) {
    // stack.sh backgrounds its own processes and returns, so this is a `run`,
    // not a tracked child — teardown is its own `down` verb.
    await run(stackScript, ['up'], { cwd: dir, env })
    onShutdown(() => console.log(`\n  backend left running — stop it with: ${stackScript} down`))
  } else {
    await startDotnetDirectly({ dir, port, corsOrigins })
  }

  await waitForHttp(lanHealth)
  return { started: true, dir, note: null }
}

/** up.sh is bash. Windows has it via Git Bash, but only if it is on PATH. */
async function hasBash() {
  const probe = await capture('bash', ['--version'])
  return probe.code === 0
}

/** `docker info` not `docker --version`: the CLI installs without the daemon running. */
async function hasDocker() {
  const probe = await capture('docker', ['info'])
  return probe.code === 0
}

/**
 * Last resort: no up.sh and no usable bash. Mirrors stack.sh's env block
 * minus the things it cannot do here: Mongo and Langflow are not started, so we
 * say so rather than letting the app fail later with an empty AI response.
 */
async function startDotnetDirectly({ dir, port, corsOrigins }) {
  const mongoUri = process.env.KITTO_MONGO_URI ?? 'mongodb://127.0.0.1:27018'

  console.log('  ! Mongo and Langflow are not auto-started on this platform.')
  console.log(`    Expecting Mongo at ${mongoUri} — set KITTO_MONGO_URI to change it.`)

  const dotnet = await capture('dotnet', ['--version'])
  if (dotnet.code !== 0) {
    throw new Error('`dotnet` is not on PATH — install the .NET SDK, or run with --skip-backend')
  }

  start('dotnet', ['run', '--project', 'Life-Admin-Autopilot-Backend', '--no-launch-profile'], {
    cwd: dir,
    env: {
      // [::] not 127.0.0.1: dual-stack, all interfaces, so the phone can reach it.
      ASPNETCORE_URLS: `http://[::]:${port}`,
      ASPNETCORE_ENVIRONMENT: 'Development',
      MongoDbSettings__ConnectionString: mongoUri,
      MongoDbSettings__DatabaseName: 'kitto_dev',
      Kernel__Cors__Origins: corsOrigins.join(','),
      Kernel__Workers__Enabled: 'true',
    },
  })
}

/**
 * Asks the RUNNING backend whether it accepts the webview's origin. The
 * allowlist is startup-only, so this is the one check that cannot be inferred
 * from config files — and its failure mode (silent network error inside a
 * webview, no console) is the worst one to debug on a phone.
 */
export async function checkCors({ lanIp, port, origin }) {
  try {
    const response = await fetch(`http://${lanIp}:${port}/health`, {
      headers: { Origin: origin },
      signal: AbortSignal.timeout(5000),
    })
    const allowed = response.headers.get('access-control-allow-origin')
    return allowed === origin || allowed === '*'
  } catch {
    return false
  }
}

/** Last assignment wins, inline comments and quotes stripped (dotenv semantics). */
async function readEnv(file, key) {
  if (!existsSync(file)) return null

  const contents = await readFile(file, 'utf8')
  const matches = contents
    .split('\n')
    .filter((line) => new RegExp(`^\\s*${key}=`).test(line))

  const last = matches.at(-1)
  if (!last) return null

  return last
    .slice(last.indexOf('=') + 1)
    .split('#')[0]
    .trim()
    .replace(/^["'](.*)["']$/, '$1')
}
