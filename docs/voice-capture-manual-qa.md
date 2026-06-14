# Voice Capture — Manual QA Checklist

> **⚠️ V2 status — mostly v1-historical.** This checklist was written for the v1
> **React Native + Expo** voice capture (Home Screen widgets, AppIntents, Live
> Activities, Dynamic Island). **None of that exists in V2.** In Next.js +
> Capacitor, voice capture is: web **`MediaRecorder`** (browser/PWA) + a **native
> Capacitor audio-recorder plugin** for foreground-started background capture
> (see `stack.md` / `PLATFORM-DECISION.md`). The widget/AppIntent/Live-Activity
> sections below are **deferred / out of scope** for V2. The **OS-level audio
> checks** (Low Power Mode, incoming call, Bluetooth routing, permission
> revocation, 5-min cap, offline queue, the `UIBackgroundModes: audio`
> entitlement + reviewer demo video) **still apply** to the Capacitor native
> recorder — keep them. Recording must **start in the foreground** (no iOS app
> can auto-start the mic from the background).

Everything below requires a **real iPhone** (the simulator can't drive background
audio or permission prompts reliably) once the Capacitor app is wrapped.

## Setup (run once per fresh device — V2 / Capacitor)

- [ ] `npm install` && `npm run build` (static export to `out/`)
- [ ] `npx cap sync ios` (after adding the native audio-recorder plugin + the
      `UIBackgroundModes: audio` capability in the iOS project)
- [ ] `npx cap run ios --target <your iPhone>`
- [ ] Sign in once and grant microphone permission via the in-app primer —
      recording is foreground-started, so the permission prompt happens in-app
- [ ] (Deferred) Home Screen widget / Lock Screen complication — **v1 only**, not
      part of the V2 Capacitor build

## Functional checks

### Home Screen widget tap (unlocked)
- [ ] Tap the widget. Expected: no app launch, recording starts, Live Activity
      appears, Dynamic Island shows the pulsing mic
- [ ] Confirm the mic-status indicator (orange dot in the status bar) appears
- [ ] Tap **Stop** in the Dynamic Island → Live Activity dismisses
- [ ] Foreground the app → toast confirms upload, transcript appears on
      Briefing within ~5s

### Lock Screen complication tap
- [ ] Lock the device
- [ ] Tap the Lock Screen complication
- [ ] Expected: **Face ID prompt appears before the mic activates** (this is
      the privacy gate from `authenticationPolicy = .requiresAuthentication`)
- [ ] After Face ID: recording starts, Live Activity appears on Lock Screen
- [ ] Tap **Stop** on the Live Activity
- [ ] Unlock and open the app → upload completed, transcript visible

### Latency budget
- [ ] Cold widget tap → "Listening…" haptic + indicator visible within **300ms**
- [ ] If consistently slower, profile the AppIntent path — likely culprit is
      AVAudioSession activation. Keep StartRecordingIntent free of any JS bridge
      calls.

### Bluetooth headset routing
- [ ] Pair AirPods
- [ ] Tap widget → confirm input routes through AirPods (check by speaking
      with phone face-down)
- [ ] Confirm Live Activity continues to update level meter

### Incoming call mid-recording
- [ ] Start a recording via widget
- [ ] Trigger an incoming call (have someone call you / use a second phone)
- [ ] Expected: recording auto-pauses, Live Activity reflects "Paused" or ends
      cleanly. The half-recorded file should still upload as a partial note.

### Low Power Mode
- [ ] Enable Low Power Mode (Settings → Battery)
- [ ] Tap widget → expect either a successful recording OR a clear in-app
      banner explaining the OS suppressed it. Silent failure is **not
      acceptable**.

### Force-quit during recording
- [ ] Start a recording via widget
- [ ] Swipe the app out of the app switcher
- [ ] Expected: Live Activity continues, AVAudioRecorder is owned by the
      extension process so the file finishes writing on the 5min cap
- [ ] Reopen the app → the captured note is in the upload queue and uploads
      automatically

### 5-minute cap
- [ ] Start a recording, let it run to 5:00
- [ ] Expected: auto-stop, Live Activity ends, file uploads

### Repeated tap
- [ ] Tap widget twice in quick succession
- [ ] Expected: second tap is a no-op (controller logs a warning, no double
      Live Activity)

### Offline behavior
- [ ] Toggle Airplane Mode on
- [ ] Capture a voice note from the widget
- [ ] Recording works, stops normally, queue persists the upload
- [ ] Toggle Airplane Mode off
- [ ] Open the app → upload completes via `useVoiceUploadDrain()` or the
      BGProcessingTask wake

### Permission revocation
- [ ] Revoke microphone permission in iOS Settings → Privacy → Microphone →
      Life Admin
- [ ] Tap widget
- [ ] Expected: the StartRecordingIntent returns a dialog "Open Life Admin
      once to allow microphone access." — **not a silent failure**

### Backend failure handling
- [ ] Kill the server / use a fake `NEXT_PUBLIC_API_URL`
- [ ] Capture three voice notes from the widget
- [ ] Open the app → upload queue retries each with exponential backoff
- [ ] After `MAX_ATTEMPTS = 5` the note stays in the queue and a banner
      surfaces on next app open
- [ ] Restore the server → next app foreground drains the queue

## App Store readiness

- [ ] `UIBackgroundModes: audio` entitlement appears in
      `ios/LifeAdminAutopilot/LifeAdminAutopilot.entitlements` after prebuild
- [ ] App Privacy questionnaire updated: microphone usage, background audio
- [ ] Microphone usage description copy makes user benefit obvious (current
      string in `app.json` covers this)
- [ ] Demo video recorded showing: widget tap → Face ID → recording → Live
      Activity → transcript. Submit alongside the binary — reviewers reject
      background audio entitlements without a clear justification.

## Known limitations

- **Android is not implemented in this phase.** The Live Activity / AppIntent
  model is iOS-only. Android equivalents (Home Screen widget +
  ForegroundService) are tracked as a follow-up.
- **Control Center tile (iOS 18+)** and **Action Button shortcut
  (iPhone 15 Pro+)** are out of scope for v1.
- **Recording cannot start before microphone permission is granted in-app
  at least once.** This is an iOS constraint, not a bug.
