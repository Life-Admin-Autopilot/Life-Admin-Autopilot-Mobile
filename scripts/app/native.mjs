// Prepares the native shell for `npm run app` and hands it to the IDE.
//
// The mode here is live-reload: `npx cap sync` writes CAP_LIVE_RELOAD_URL into
// the native capacitor.config.json (see capacitor.config.ts), so the webview
// loads the whole app from `next dev` over the LAN instead of the bundled
// snapshot. Edit a file, the phone reloads — same loop as the browser.
//
// Xcode/Android Studio rather than `cap run`: signing is the first thing that
// goes wrong on a real device, and the IDE reports it as a fixable UI state
// instead of an opaque CLI exit code.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './proc.mjs'

const NPX = 'npx'

export async function prepareNative({ repoRoot, platform, liveReloadUrl, apiUrl }) {
  await ensureWebDir(repoRoot, apiUrl)
  await ensurePlatform({ repoRoot, platform })

  // The live-reload URL is read from the environment by capacitor.config.ts at
  // sync time and baked into the native config — so it must be set HERE, not
  // when the IDE later builds.
  await run(NPX, ['cap', 'sync', platform], {
    cwd: repoRoot,
    env: { CAP_LIVE_RELOAD_URL: liveReloadUrl },
  })

  if (platform === 'ios') await patchIos(repoRoot)
  else await patchAndroid(repoRoot)
}

export async function openIde({ repoRoot, platform }) {
  try {
    await run(NPX, ['cap', 'open', platform], { cwd: repoRoot })
  } catch {
    const ide = platform === 'ios' ? 'Xcode' : 'Android Studio'
    console.log(`\n  ! Could not open ${ide} automatically.`)
    console.log(`    Open ${join(repoRoot, platform)} in ${ide} by hand and press Run.`)
    if (platform === 'android') {
      console.log('    If it is installed somewhere non-standard, set CAPACITOR_ANDROID_STUDIO_PATH.')
    }
  }
}

/**
 * `cap sync` refuses to run without webDir, even in live-reload where the
 * bundled snapshot is never loaded. Build it once rather than faking it: if the
 * dev server later dies, the phone falls back to a real app instead of a blank
 * page.
 */
async function ensureWebDir(repoRoot, apiUrl) {
  if (existsSync(join(repoRoot, 'out'))) return

  console.log('  · No out/ yet — building the static export once (Capacitor requires it).')
  // Bake the LAN backend in, not .env.local's localhost: if the dev server dies
  // the phone falls back to this bundle, and a localhost API URL there would
  // make it resolve to the phone itself.
  await run('npm', ['run', 'build'], {
    cwd: repoRoot,
    env: { NEXT_PUBLIC_API_URL: apiUrl },
  })
}

/** ios/ and android/ are gitignored and regenerable — add on demand. */
async function ensurePlatform({ repoRoot, platform }) {
  if (existsSync(join(repoRoot, platform))) return

  console.log(`  · No ${platform}/ project yet — creating it.`)
  await run(NPX, ['cap', 'add', platform], { cwd: repoRoot })
}

/**
 * Both patches are dev-only and both are lost on every `cap add`/`sync`, because
 * ios/ is fully regenerated (docs/CAPACITOR.md):
 *   --local-http  App Transport Security exception, without which iOS blocks
 *                 every plaintext call to the LAN backend.
 *   highrefresh   lifts WebKit's 60fps render cap (private API — dev only).
 */
async function patchIos(repoRoot) {
  await run('./scripts/patch-ios-plist.sh', ['--local-http'], { cwd: repoRoot })
  await run('./scripts/patch-ios-highrefresh.sh', [], { cwd: repoRoot })
}

/**
 * Restores the Firebase config `cap sync` cannot preserve, so Android gets FCM
 * push. Warns rather than fails when the file is absent — a build without push
 * is the supported fallback, not an error. See scripts/patch-android-firebase.mjs
 * for why iOS has no equivalent.
 */
async function patchAndroid(repoRoot) {
  await run('node', ['scripts/patch-android-firebase.mjs'], { cwd: repoRoot })
}
