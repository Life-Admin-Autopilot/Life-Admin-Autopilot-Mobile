import type { CapacitorConfig } from '@capacitor/cli'

// CAP_LIVE_RELOAD_URL is set only by the ios:dev/android:dev npm scripts,
// pointing at the machine's `next dev` server (localhost for the iOS
// Simulator, LAN IP for the Android emulator/device — see docs/CAPACITOR.md).
// Left unset for `cap sync` / prod builds, which load the bundled `out/`
// snapshot instead.
const liveReloadUrl = process.env.CAP_LIVE_RELOAD_URL

// Set by `npm run cap:sync:android:dev`. A BUNDLED dev build is served from
// https://localhost (Capacitor's androidScheme default), so a plain http://
// backend is refused by the webview before it reaches the network:
//   "Mixed Content: ... requested an insecure resource
//    'http://10.0.2.2:4000/auth/signup'. This request has been blocked"
// It reads as "no connection" in the app, which sends you looking at CORS and
// the emulator's network — neither of which is involved.
//
// Deliberately NOT unconditional: production points at an https API
// (.env.production), where allowing mixed content would only weaken the app.
// This is the bundled-build sibling of the `cleartext` concession below, which
// covers live-reload only.
const androidDevHttp = process.env.KITTO_ANDROID_DEV_HTTP === '1'

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
  ...(androidDevHttp ? { android: { allowMixedContent: true } } : {}),
}

export default config
