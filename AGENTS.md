# Life Admin Autopilot — Mo V2 (Next.js + Capacitor)

Next.js (App Router, **static export**) + Capacitor + TanStack Query + Zustand + Tailwind + shadcn/ui. Backend lives in `server/` (Express + Mongo, JWT auth); the frontend talks via `lib/api/client.ts` against `NEXT_PUBLIC_API_URL`. No Supabase. No Drizzle.

> **Status: blueprint.** The Next.js app isn't initialized yet. This file is the contract for the rebuild. Where it says "do X," it means "the rebuild does X." See `README.md` for the start sequence and `docs/PORTING-GUIDE.md` for what carries over from v1.

## Stack truth — how this differs from v1 and from generic rules

This is a **web app shipped to app stores via Capacitor**, not a React Native app and not a plain website. When a generic global rule conflicts with this file, **this file wins — say so, don't silently follow the global rule.** Specifically:

- **Disregard React Native / Expo rules.** No `expo-*`, no NativeWind, no Metro, no Maestro-only e2e, no `expo install`. v1's `.claude/skills/vercel-react-native-skills` do **not** apply. The old `CLAUDE.md` ban on `moti`/`react-native-reanimated` is moot (those libraries aren't here).
- **Disregard Supabase / Drizzle / repository-pattern / API-envelope guidance.** Backend is **Express + MongoDB** in `server/`. Drizzle/SQLite is not used.
- **Disregard SSR/server-component-heavy web rules.** We run Next.js as a **static-exported client SPA** (`output: 'export'`) so Capacitor can bundle it. See "Static-export discipline" below.
- **Follow verify-on-a-real-build** (below) over "TDD-first / 80% coverage before code" and "write PRD/arch docs before coding."

Dependencies: standard `npm install` (this is web — the `expo install` rule is gone). Prefer `npx shadcn@latest add <component>` for primitives.

## Read for context (only when relevant)

- `docs/ARCHITECTURE.md` — target structure, data flow, deployment path
- `docs/PORTING-GUIDE.md` — what ports as-is vs. rebuild
- `docs/PLATFORM-DECISION.md` — why this stack + the iOS/Capacitor constraints
- `docs/LESSONS.md` — v1 lessons (read before repeating v1 mistakes)
- `docs/tokens.md` — design tokens for `app/globals.css` (`@theme`, Tailwind v4)
- `docs/new-direction.md` — the brand brief (the silent sovereign) — source of truth
- `docs/overview.md` / `docs/principles.md` — product scope, the single product test
- `docs/aesthetic.md` / `docs/design.md` — **the visual direction** (white marble + crimson)
- `docs/primitives.md` — component contracts (re-mapped to web; see PORTING-GUIDE)
- `docs/stack.md` — **out of date** on backend; trust the code in `server/`

## Commands (once the app is initialized)

- `npm run dev` — Next dev server (browser, fast iteration — this is where you live)
- `npm run build` — static export to `out/`
- `npx cap sync` — push the web build into the native iOS/Android projects
- `npx cap run ios` / `npx cap run android` — run on simulator/device (required before claiming "done" for native features)
- `npm test` — Vitest (logic)
- `npm run lint` / `npm run typecheck`

---

## Rules

### Static-export discipline

The app is a **client SPA** (`next.config` → `output: 'export'`). Therefore:
- **No on-device SSR and no Next.js API routes for app logic.** All data comes from the separate Express backend over HTTP. (You may use a tiny Next route only for local web tooling that never ships in the Capacitor bundle — avoid it.)
- Use `next/image` with `unoptimized: true` (no image server on-device) or a static loader.
- Routing is client-side; design every route to render from client state + TanStack Query, not server props.

### Data access lives in `queries/`

Every data hook lives in `queries/` (TanStack Query). Components consume hooks only. The HTTP seam is `lib/api/client.ts`. Never raw `fetch()` or hardcoded URLs in feature code. Query keys come from `queries/keys.ts`. These layers port nearly unchanged from v1 — see PORTING-GUIDE.

### Capacitor & native capabilities — the rules that bit us in research

- **Push notifications use `@capacitor/push-notifications` (native APNs/FCM), NEVER Web Push.** Apple's WKWebView (what the Capacitor iOS shell uses) does not support the Web Push API. Web Push only works for a Safari "Add to Home Screen" PWA, not the store-shipped app. So for the iOS app: native plugin only.
- **Background audio requires a native recorder plugin + the background-audio entitlement + a visible "recording" affordance.** A web `MediaRecorder` mic is muted by iOS seconds after backgrounding. Use a native Capacitor audio-recorder plugin (e.g. `@capgo/capacitor-audio-recorder` or Capawesome's) with `UIBackgroundModes: audio`. **You cannot auto-start the mic from the background on iOS** — recording must begin in the foreground and continue; design the product around that. The background-audio entitlement carries App Store **guideline 4.2** review risk, so always show an active-recording UI to justify it.
- **Voice recording goes behind one interface** — web `MediaRecorder` impl + native-plugin impl — so feature code calls one API and Capacitor picks the right one per platform.
- **Don't reach for native APIs when a web API suffices.** Native plugins only where the web genuinely can't deliver (push, background audio, secure storage, haptics).

### Verify on a real build before claiming "done"

Vitest against mocks is necessary, not sufficient — "all unit tests pass" shipped real bugs in v1. A feature is **not done** until: (1) it works in the browser via `npm run dev` walking the actual flow including error paths, (2) for anything touching a native plugin, it's been run on a device/sim via `npx cap run`, (3) zero new console errors/warnings. If you can't run it, say so — don't claim "done."

### Styling — tokens only

Real Tailwind now (**v4 — CSS-first**). Tokens live in `app/globals.css` inside `@theme` blocks — there is **no `tailwind.config.ts`**. Use the semantic tokens from `docs/tokens.md`. **No hex literals, no `text-[15px]`, no `gray-500`/`red-600`/etc.** in components. Semantic names only (`bg-canvas`, `text-ink-muted`, `text-display-hero`, `text-accent`).

**Aesthetic = "white marble + crimson" — the silent sovereign.** Canvas is warm marble (`bg-canvas` `#F3F0EA`); cards are white `surface` with a hairline `border` and a whisper-soft shadow. **Deep crimson (`accent` `#A4161A`) is the single working accent + brand color** — primary button = crimson filled rounded rectangle (`rounded-md`, not a pill), secondary = white + crimson text + hairline. One crimson focal point per surface; never paint everything red. Display type is **serif** (Cormorant); body is **Inter**. **Gold is premium-tier only.** No green, no celebration color. Monumental negative space is part of the brand. See `docs/aesthetic.md`.

### Primitives are the only UI surface

Need a button, sheet, dialog, input, toast, skeleton? Use `components/ui/*` built on **shadcn/ui (Radix)**, preserving the contracts (`Button`, `Card`, `Input`, `ScreenShell`, `GlassSheet`→Radix sheet/drawer, `Toast`→`sonner`, `CircleIconButton`, `TabBar` — five slots with the crimson **cross** center create-action). No raw `<button>` for buttons. No `window.alert()`/`confirm()`. `lib/toast.ts` is the only toast source. See `docs/primitives.md`.

### Component file shape

One component per `.tsx` file. 500-line hard cap. Filenames match the primary component (PascalCase). Exception: `components/ui/*` compound primitives.

### State

Server state → TanStack Query. Shared client state → Zustand (one store per concern). Forms → React Hook Form + Zod (`z.infer<typeof schema>` is the type). URL state → Next.js route/search params. No Redux, no Context for app state. **Zustand selectors returning new arrays/objects must use `useShallow`** (this caused `Maximum update depth exceeded` in v1).

### `useEffect` discipline

Default answer is don't. Acceptable: subscribing to external systems (Capacitor App/Network listeners, `visibilitychange`), syncing with non-React APIs, debounced commits. Otherwise use `useMemo`, TanStack Query, an event handler, or render-time computation. Every subscription returns a cleanup.

### Async surfaces need all three states

Loading (skeleton matching the real shape, never a generic spinner for page loads), error (message + retry, never silent), empty (designed state with an affordance). Branch on `isLoading` and `error`, never on `data` truthiness.

### Motion — static-first, deliberate, opt-in

v1 shipped with **all** animations stripped because React Native's Reanimated/Moti caused render loops and freezes. **That was an RN-stack failure mode and does not apply to web CSS.** So the absolute ban is lifted — but the *intent* carries: stability and correctness over motion.
- Default to **static** surfaces (conditional render, not cross-fades).
- **CSS transitions/`@keyframes` are allowed** for small, GPU-friendly effects (`transform`, `opacity`) — introduce them deliberately, not everywhere.
- **No heavy JS animation libraries by default.** The **one sanctioned exception** is `framer-motion`, approved for the core "Dynamic Island" morph (ported verbatim from Wiscord — do not retune the physics; see `lib/motion.ts`). It is used **only** through the morph primitives — `components/ui/MorphSurface.tsx` (persistent shell, e.g. chatbot/voice FAB↔panel), `components/ui/MorphPanel.tsx` (transient mount/unmount, e.g. dropdowns), `components/ui/MorphToast.tsx` (via `lib/toast.ts`), and `app/template.tsx` (page-transition enter) — and only on these surfaces: dropdowns, page transitions, chatbot popup, voice record popup, toasts. Anywhere else, raise it with the user first.
- Never animate layout properties (`width`, `height`, `margin`, `padding`).
- **No celebration.** The institution does not congratulate — no confetti, streak pops, or success bursts. The one signature flourish permitted is a slow crimson-vein opacity pulse on the hero King (opacity only, honors `prefers-reduced-motion`).
See `docs/LESSONS.md` for the full story.

### UI voice — institutional, not chatty

The system **states facts, reports status, executes requests.** Concise, direct, authoritative — never excited, cheerful, or conversational. No emoji, no exclamation marks, no motivational language, no unnecessary words. The product noun is **"matters"** (not "tasks").

- State, don't chat. `5 matters require attention.` / `Car insurance expires in 3 days.` / `Task created. Policy attached.`
- Errors are factual, not friendly. Translate raw backend errors (`lib/translateBackendError.ts`) — never surface `Error 503`, but say `Document unavailable. Retry.` not `Couldn't reach it — try again?`.
- Buttons commit to verbs (`Create matter`, `Attach document`) — never `Submit`/`OK`.
- One accent per surface. Crimson is the focal action. The goal is **relief** — order restored, never urgency manufactured.

### Trust contract (AI provenance) — priority #1

The biggest accuracy risk is the AI extracting a wrong value (wrong renewal date, "1/12" misread). **One wrong reminder loses trust permanently.**
- Every AI-derived value renders with a **CitationChip** showing its source.
- Below the confidence threshold, render in `warning` tone and **ask instead of guessing**.
- Provide a source viewer for every cited value.
- **If a surface renders an AI-derived value without provenance, it is NOT done.**

### Icons and emoji

- **No emoji in UI, anywhere.** Domain identity uses a `DomainIcon` component; generic icons use lucide outline in crimson or `ink`. Custom SVGs live in `components/icons/`.
- **The cross** (crimson) is the system's action/brand mark — the center create-action and the brand glyph. Don't repurpose it as a generic icon.
- **The King is a symbol, not an icon.** The marble sovereign (`assets/brand/king.png`) appears only in hero / splash / empty surfaces — centered, monumental, never as chrome, never small, never animated playfully. No "magic" sparkle/wand/bot icons — AI is invisible and institutional here; the King "simply knows."
- **The mic/record affordance** is a restrained crimson control — never a mascot, never a beige badge. (The old clay-mic mascot under `assets/images/mascot/` is obsolete.)
- **Domain colors** come from `DOMAIN_INK` in `lib/colors.ts` (re-derived as low-chroma stone tints — see `tokens.md`).
- **Third-party brands use real logos** under `assets/logo/<service>`.
- **No raw IDs in UI** (UUIDs, hash slices) — generate deterministic friendly names.

### Dates

Store and transmit as **ISO 8601 UTC**. For display use `Intl.DateTimeFormat` or `lib/date.ts`.
- Note: `Intl.RelativeTimeFormat` is **safe on web / in WKWebView** — v1's ban on it was a Hermes (RN) crash, not a web issue. Still, keep using `lib/dueLabel.ts` for "2 days ago"/"in 3 hours" so the logic is testable and consistent.

### Assets

Raster images are `.webp`/`.avif` (no `.png`/`.jpg`). Always set explicit `width`/`height` (use `next/image`). Above-the-fold uses `priority`; everything else lazy.

### Module boundaries

- **`lib/` is pure by default** — pure logic/format modules (`lib/date.ts`, `lib/dueLabel.ts`, `lib/cn.ts`, `lib/translateBackendError.ts`, `lib/colors.ts`) must NOT do I/O or import framework runtime.
- **Documented seam exceptions** (the client/outside-world layer): `lib/api/*` (HTTP), `lib/voice/*` (Capacitor audio/upload), `lib/auth/*` (session/cookies), `lib/*Store.ts` (Zustand client stores), `lib/env.ts`. These intentionally touch the platform; don't "fix" them by relocating.
- `queries/` may import `lib/`, `types/`, `lib/api`. Components/hooks consume `queries/` hooks only.
- `hooks/` may not import from `components/`.
- `app/` routes don't import other route files — compose via `components/`.

### Commits

Conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, `perf:`, `ci:`). Branches `feat/<slug>`, `fix/<slug>` — lowercase, hyphenated. **Never `--no-verify`.** No `console.log` — use `lib/logger.ts`.

### TypeScript

No `as any` (`@typescript-eslint/no-explicit-any: error`). Use `unknown` + Zod narrowing. No `React.FC` — type props with a named `interface`. Public exports get explicit signatures; locals can infer.
