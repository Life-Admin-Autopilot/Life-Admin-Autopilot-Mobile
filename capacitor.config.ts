import type { CapacitorConfig } from '@capacitor/cli'

// CAP_LIVE_RELOAD_URL is set only by the ios:dev/android:dev npm scripts,
// pointing at the machine's `next dev` server (localhost for the iOS
// Simulator, LAN IP for the Android emulator/device — see docs/CAPACITOR.md).
// Left unset for `cap sync` / prod builds, which load the bundled `out/`
// snapshot instead.
const liveReloadUrl = process.env.CAP_LIVE_RELOAD_URL

const config: CapacitorConfig = {
  // Must be globally unique across the App Store — `com.lifepilot.app` was
  // already registered to another account, so a Personal Team could not claim
  // it. Changing this alone does NOT update an existing ios/ project; it only
  // applies to a fresh `npx cap add ios`. Keep it in sync with
  // PRODUCT_BUNDLE_IDENTIFIER in ios/App/App.xcodeproj/project.pbxproj.
  appId: 'com.kitto.app',
  appName: 'Kitto',
  webDir: 'out',
  ...(liveReloadUrl
    ? {
        // cleartext: dev-only concession so a plain http:// LAN URL isn't
        // blocked. This option is ANDROID-ONLY — it does nothing for iOS App
        // Transport Security. iOS gets its equivalent from the Info.plist keys
        // applied by `./scripts/patch-ios-plist.sh --local-http`.
        // Never set outside live-reload.
        server: { url: liveReloadUrl, cleartext: true },
      }
    : {}),
}

export default config
