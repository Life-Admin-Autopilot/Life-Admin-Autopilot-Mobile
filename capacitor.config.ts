import type { CapacitorConfig } from '@capacitor/cli'

// CAP_LIVE_RELOAD_URL is set only by the ios:dev/android:dev npm scripts,
// pointing at the machine's `next dev` server (localhost for the iOS
// Simulator, LAN IP for the Android emulator/device — see docs/CAPACITOR.md).
// Left unset for `cap sync` / prod builds, which load the bundled `out/`
// snapshot instead.
const liveReloadUrl = process.env.CAP_LIVE_RELOAD_URL

const config: CapacitorConfig = {
  appId: 'com.lifepilot.app',
  appName: 'LifePilot',
  webDir: 'out',
  ...(liveReloadUrl
    ? {
        // cleartext: dev-only concession so a plain http:// LAN URL isn't
        // blocked by iOS App Transport Security. Never set outside live-reload.
        server: { url: liveReloadUrl, cleartext: true },
      }
    : {}),
}

export default config
