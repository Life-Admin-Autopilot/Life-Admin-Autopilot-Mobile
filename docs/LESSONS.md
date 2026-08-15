# Lessons from Mo v1 — read before repeating them

Hard-won knowledge from the React Native build. These shaped the rules in `AGENTS.md`.

## 1. Most of the pain was the native toolchain, not React
The recurring time-sinks were the Android emulator (mic not working), `adb` daemon noise breaking the PowerShell fresh-boot script, and native build scripts — not application logic. **Lesson for v2:** the web stack removes this entire layer. Even in v1, the single biggest fix would have been *testing on a real device instead of the emulator* — the emulator mic problem doesn't exist on a physical phone. Whatever the stack, prefer a real device for anything touching hardware (mic, camera, push).

## 2. Why all animations were removed — and why that ban does NOT transfer to web
On 2026-06-01 every Moti / Reanimated animation was stripped app-wide (mount/exit/layout transitions, `AnimatePresence`, press-scale, shimmer, audio-reactive visualizers) because the motion layer kept causing **render loops and freezes** — e.g. an infinite render in the inline clarify card and a chat-streaming freeze.

**Critical nuance:** that was a *React Native Reanimated/Moti* failure mode — shared values, the JS/UI thread bridge, `AnimatePresence` reconciliation. **It does not exist for plain web CSS transitions.** So v2 does **not** inherit a blanket animation ban. Instead: static-first by default, CSS `transform`/`opacity` transitions allowed deliberately, no heavy JS animation libs (Framer Motion etc.) without asking first. The *intent* (stability over motion) carries; the absolute prohibition does not. (See `AGENTS.md` → Motion.)

## 3. The Trust Contract is the #1 product rule
The product dies on **one wrong reminder** (wrong renewal date, "1/12" misread as Jan 12). Every AI-derived value must render with a **CitationChip** (source), drop to `warning` tone + **ask instead of guess** below the confidence threshold, and have a source viewer. A surface that shows an AI value without provenance is not done. This is a design-system-level invariant, not a feature.

## 4. Voice-recorder lifecycle gotchas
v1 burned days on the recorder. Root causes that recur in any recording stack:
- **Double `start()`** / preparing an already-prepared recorder → `IllegalStateException`.
- **State desync** between the recorder's internal state machine and React state.
- Metering/waveform sampling coupled too tightly to the update frequency caused churn — decouple sampling from metering.
**Lesson:** model the recorder as an explicit state machine (idle → preparing → recording → stopping), guard transitions, and never call lifecycle methods off React render. For v2, hide all of this behind one `lib/voice` interface (web `MediaRecorder` / native plugin).

## 5. Zustand selectors need `useShallow`
Selectors returning a new array/object every render caused `Maximum update depth exceeded`. Always wrap object/array selectors in `useShallow`. Carries to web unchanged.

## 6. The brand color is **crimson** (the rebrand superseded indigo)
The product rebranded to the "white marble + crimson" silent-sovereign system (see `new-direction.md` / `aesthetic.md`). The old warm-cream + **indigo** + Nunito + mascot system — and every "indigo is the brand" note — is **retired**. **Deep crimson (`accent` `#A4161A`) is the single working accent + brand color** (primary action, links, active tab, the cross). The "magic" AI icons (`Sparkles`, `Wand`, `Brain`, `Bot`) are also retired — AI is invisible and institutional here; the King "simply knows." Don't reintroduce indigo, the mascot, or sparkle icons.

## 7. "All unit tests pass" ≠ done
v1 shipped bugs the user hit on first launch despite green Vitest runs (mocks hid them). Verify by actually running the flow — browser first, device for native features. (See `AGENTS.md` → Verify on a real build.)

## 8. Real-time freshness needs focus-refetch + a unified query
The briefing/home showed stale tasks until v1 unified everything onto one `useOpenTasks` hook with focus-triggered refetch and cache reconciliation. Reuse that pattern: one source-of-truth query per surface, refetch on focus/visibility, reconcile mutations into the cache (optimistic insert on clarification resolve, sync tool-call results). The logic is portable — see `queries/` in v1.

## 9. Date handling
Store/transmit ISO 8601 UTC; format via `Intl.DateTimeFormat`. v1 banned `Intl.RelativeTimeFormat` because it **crashed under Hermes (RN)** — that's not a web problem, so it's safe in v2. Still keep `lib/dueLabel.ts` so relative labels are pure and testable.

## 10. `next dev` on a LAN IP silently breaks client-side navigation
Capacitor live-reload serves the webview from `http://<LAN-IP>:3000`, and Next treats any non-localhost origin as untrusted in dev: the first paint succeeds, then the client-side navigation off the boot splash fetches its route payload from `/_next`, that request is blocked, and **the app sits on `AppSplash` forever with nothing in the UI to say why**. It reads exactly like a dead backend — but it reproduces with no tokens in storage, where no backend call is made at all.

Two things make it expensive to diagnose. The screen you get is the web app's own splash, not the iOS launch storyboard (they look nearly identical — the storyboard asset has no "Kitto" wordmark, which is how to tell them apart). And it does not reproduce at `localhost:3000`, so "works on web" is not evidence.

**Fix:** `allowedDevOrigins` in `next.config.ts`, fed the detected LAN IP by `scripts/app.mjs`. **Diagnosis shortcut:** load the LAN URL and a `localhost` URL in the same browser with empty storage — if only the LAN one hangs, it is origin trust, not the network. A failing `/_next/webpack-hmr` WebSocket is the visible tell.
