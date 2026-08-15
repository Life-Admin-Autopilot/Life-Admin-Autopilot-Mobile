// Process + readiness helpers shared by `npm run app` (scripts/app.mjs).
//
// Windows is a first-class target here, which drives two things the rest of the
// repo's bash scripts never had to care about:
//   - `npx`/`dotnet` are batch shims on Windows, so spawn() cannot exec them
//     directly — every call needs `shell: true` there, and MUST NOT use it on
//     POSIX (it would re-parse our already-split argv).
//   - there is no `lsof`/`nc`, so "is it up?" is answered by an HTTP probe
//     rather than a port scan. That is the better question anyway: a port that
//     accepts a socket but 500s on /health is still a broken backend.

import { spawn } from 'node:child_process'

const IS_WINDOWS = process.platform === 'win32'
const POLL_INTERVAL_MS = 1000
const PROBE_TIMEOUT_MS = 2500

const children = new Set()
const shutdownHooks = []

/** Long-lived child (dev server, backend). Tracked so Ctrl-C tears it down. */
export function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: IS_WINDOWS,
    ...options,
    env: { ...process.env, ...options.env },
  })

  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}

/** One-shot command. Rejects on a non-zero exit so callers can fail loudly. */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: IS_WINDOWS,
      ...options,
      env: { ...process.env, ...options.env },
    })

    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

/** One-shot command whose output we want to inspect rather than show. */
export function capture(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: IS_WINDOWS,
      ...options,
      env: { ...process.env, ...options.env },
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', () => resolve({ code: 1, stdout, stderr }))
    child.on('exit', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

/**
 * GETs `url` until it answers 2xx or `timeoutMs` elapses.
 *
 * Pass `child` when a specific process is supposed to be serving it: a crashed
 * dev server otherwise looks exactly like a slow one, and the difference is two
 * minutes of staring at nothing before a timeout that names the wrong problem.
 *
 * Returns the winning Response so callers can read headers off it — the CORS
 * check needs `access-control-allow-origin` from the same probe that proved the
 * server is up.
 */
export async function waitForHttp(url, { timeoutMs = 90_000, headers = {}, child = null } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastError = 'no response'

  let exited = null
  child?.once('exit', (code) => (exited = code))

  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`the process serving ${url} exited with ${exited} — see the output above`)
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      if (response.ok) return response
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error.name === 'TimeoutError' ? 'timed out' : error.message
    }
    await sleep(POLL_INTERVAL_MS)
  }

  throw new Error(`${url} never came up (${lastError})`)
}

/** Single non-blocking probe — "is something already listening here?" */
export async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return response.ok
  } catch {
    return false
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function onShutdown(hook) {
  shutdownHooks.push(hook)
}

/**
 * Installs the Ctrl-C handler. Idempotent per signal because Node delivers
 * SIGINT to the whole process group: without the guard, a second Ctrl-C while
 * children are still dying would re-enter this and double-print.
 */
export function installShutdown() {
  let shuttingDown = false

  const teardown = () => {
    if (shuttingDown) return
    shuttingDown = true

    for (const hook of shutdownHooks) {
      try {
        hook()
      } catch {
        // A failing teardown hint must not block killing the children.
      }
    }
    for (const child of children) child.kill('SIGTERM')

    process.exit(0)
  }

  process.on('SIGINT', teardown)
  process.on('SIGTERM', teardown)
}
