# Platform Decision — Why Next.js + Capacitor

**Date:** 2026-06-14. **Decision:** rebuild Mo on **Next.js (static export) + Capacitor**, off React Native / Expo.

## Why we moved off React Native

Most of v1's pain was the **native toolchain**, not React:
- Microphone not working **on the Android emulator** (an emulator config issue — real devices are fine).
- `adb` daemon / `fresh-android.ps1` / PowerShell stderr escalation breaking the fresh-boot script.
- `AudioRecorder` lifecycle crashes (double `start()`, state desync).
- Reanimated/Moti render loops (the reason animations were stripped — see `LESSONS.md`).

The owner is a Next.js/web expert with no RN experience. On the web stack, the entire native-build + emulator layer disappears (browser refresh instead of emulator/adb), which removes the bulk of that friction.

## The capability question we had to settle

The worry was: does leaving RN cost us native capabilities (push, background audio)? We researched it. Summary:

### A wrapped PWA is NOT the same as a home-screen PWA on iOS
| | Web Push | App Store | Offline |
|---|---|---|---|
| Home-screen PWA (Safari → Add to Home Screen) | ✅ iOS 16.4+, home-screen install only | ❌ | ✅ |
| **PWABuilder iOS package** (WKWebView, in store) | ❌ **Web Push dead in WKWebView** | ⚠️ 4.2 rejection risk | ✅ |
| **Capacitor** (WKWebView + native plugins) | ✅ via **native APNs plugin** (not Web Push) | ✅ | ✅ |

- **WKWebView does not support Web Push** — confirmed by Apple. So a PWABuilder iOS wrapper can't do web push; you'd have to add native Firebase anyway. Capacitor sidesteps this entirely with `@capacitor/push-notifications` (native APNs/FCM).
- **PWABuilder iOS packages frequently hit App Store guideline 4.2** ("repackaged website"). Each reject→resubmit is days–weeks.
- **Android is easy everywhere** — PWABuilder's Trusted Web Activity runs real Chrome (full web push, passes Play). The iOS path is the only hard part, and Capacitor solves it.

### Background audio capture — an iOS ceiling, equal for everyone
- A web `MediaRecorder` mic is **muted by iOS seconds after backgrounding** (WKWebView behavior). So pure PWA/PWABuilder **cannot** do background capture.
- **Capacitor + a native audio-recorder plugin** (e.g. `@capgo/capacitor-audio-recorder`, Capawesome) + `UIBackgroundModes: audio` **can** continue a recording in the background — the same capability React Native gives, reaching the same native `AVAudioSession`.
- **No iOS app — RN, Capacitor, or fully native — can auto-start the mic from the background.** "Always-on listening" is impossible on iOS for everyone. Recording must start in the foreground and continue. The background-audio entitlement also needs a visible recording UI to pass review (guideline 4.2).

### Conclusion
For this app's needs, **Capacitor matches React Native** (native push, foreground-started background audio, app-store presence) while giving web-speed iteration. A **pure** PWA/PWABuilder would lose native iOS push and background capture — so we use Capacitor, not a bare PWA, and keep the PWA/TWA path as a fast early-shipping bonus.

## The path
Next.js static export → ship as PWA + PWABuilder Android (TWA) early → wrap in Capacitor for iOS native push/background when needed. One codebase throughout.

## Sources (researched 2026-06-14)
- Apple Developer Forums — Web Push not supported in WKWebView (`developer.apple.com/forums/thread/760767`)
- PWABuilder iOS push issue (`github.com/pwa-builder/pwabuilder-ios/issues/6`)
- Apple Developer Forums — WKWebView mic muted on background (`developer.apple.com/forums/thread/689182`)
- Apple Developer Forums — background audio mode / can't start session from background, rejections (`developer.apple.com/forums/thread/91872`)
- Apple Guideline 4.2 minimum-functionality rejections (`developer.apple.com/forums/thread/704430`)
- mobiloud — publishing a PWA to the stores, 2026 (`mobiloud.com/blog/publishing-pwa-app-store`)
- magicbell — iOS PWA limitations (`magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide`)
- Capacitor audio-recorder plugins: `github.com/Cap-go/capacitor-audio-recorder`, `capawesome.io/docs/plugins/audio-recorder/`
