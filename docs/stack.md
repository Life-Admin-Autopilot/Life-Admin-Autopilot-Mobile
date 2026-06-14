# Life Admin Autopilot — Stack

> The authoritative V2 stack: **Next.js (static export) + Capacitor + Tailwind v4 +
> shadcn/ui**, talking to the Express/Mongo backend in `server/`. The old React
> Native / Expo / NativeWind stack is fully retired — see `PLATFORM-DECISION.md` for
> why and `PORTING-GUIDE.md` for what carried over. `AGENTS.md` is the binding rule set.

The stack is deliberately small and web-native: the team are Next.js developers, and
the app ships as a static web bundle wrapped by Capacitor for the app stores.

## Frontend

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Next.js 16 (App Router, static export)** | `output: 'export'` → a client SPA in `out/`. No SSR, no Next API routes for app logic. |
| Native shell | **Capacitor** | Wraps the static build for iOS/Android. Native plugins only where the web can't deliver (push, background audio, secure storage). |
| Language | **TypeScript** (strict) | `any` is banned (`@typescript-eslint/no-explicit-any: error`). |
| Routing | **Next.js App Router** | Client-side routing; every route renders from client state + TanStack Query. |
| Styling | **Tailwind v4** (CSS-first) | Tokens in `app/globals.css` `@theme` — **no `tailwind.config.ts`**. See `tokens.md`. |
| Component primitives | **shadcn/ui (Radix)** | `npx shadcn@latest add <component>` into `components/ui/*`; restyled to the marble/crimson tokens. |
| Server state | **TanStack Query** | All reads/mutations via `queries/*` hooks. HTTP seam is `lib/api/client.ts`. |
| Client state | **Zustand** | One store per concern. Object/array selectors use `useShallow`. |
| Form state | **React Hook Form + Zod** | `z.infer<typeof schema>` is the type. |
| Data access | **HTTP via `lib/api/*`** | Feature code calls `queries/*`; never raw `fetch()`. Base URL = `NEXT_PUBLIC_API_URL`. |
| Auth storage | **httpOnly refresh cookie + in-memory access token** (web) / **Capacitor Secure Storage** (native) | `lib/auth/sessionStore.ts`. Never localStorage for long-lived secrets in prod. |
| Icons | **lucide-react** | Outline. Crimson/ink. The cross is the brand action mark. No emoji, no "magic" icons. |
| Fonts | **`next/font/google`** | **Cinzel** (wordmark), **Cormorant Garamond** (serif display), **Inter** (body). See `tokens.md`. |
| Motion | **CSS transitions/keyframes** (sparingly) | No heavy JS animation libs by default. No celebration. Honor `prefers-reduced-motion`. |
| Lint / format | **ESLint (eslint-config-next) + Prettier** | `no-explicit-any` error; single quotes, no semicolons. |
| Unit tests | **Vitest** | Logic/units. "All unit tests pass" ≠ done — verify in the browser/device. |

## Backend (live — `server/`, unchanged from v1, client-agnostic)

The app talks to it over HTTP at `NEXT_PUBLIC_API_URL`.

| Layer | Choice | Notes |
|---|---|---|
| Runtime | **Node + Express + TypeScript** | `server/src/app.ts` wires routers; `index.ts` boots it + the voice worker. |
| Database | **MongoDB via Mongoose** | Models in `server/src/models/*`. **No Postgres, no Supabase, no Drizzle.** |
| Auth | **JWT** (access + refresh) | Email/password, magic-link, session/refresh (`server/src/routes/auth.*`). Refresh handled by the client mutex in `lib/api/client.ts`. |
| AI provider | **Google Gemini** via `@google/genai` | Server-side only; the client never holds the key. Model pinned by `GEMINI_STRONG_MODEL` (`gemini-2.5-flash`). |
| Security | **helmet + cors** (allowlist via `CORS_ORIGINS`), JSON body limit, `pino-http` | See `server/src/app.ts`. The web client needs its dev origin in `CORS_ORIGINS`. |

## Voice

- **Capture behind one interface (`lib/voice/*`):** web **`MediaRecorder`** in the browser/PWA; a **native Capacitor audio-recorder plugin** (+ `UIBackgroundModes: audio`) for background capture on iOS/Android. Feature code calls one API; the platform picks the impl. (No iOS app can auto-start the mic from the background — recording starts in the foreground; see `PLATFORM-DECISION.md`.)
- **Speech-to-text:** live, server-side, via **Gemini** with inline audio. Async voice notes use the background transcriber (`server/src/lib/voiceNoteTranscriber.ts`); synchronous chat voice uses `server/src/modules/ai/audioTranscriber.ts`. Both retry transient 503/429 with backoff. STT is **not mocked**.

## AI (live integration)

- **Chat agent with tool calling** (`server/src/modules/ai/*`): the model proposes tool calls (create/update/complete/delete/snooze/query); state-changing calls require user confirmation in the UI.
- **Citations:** assistant text carries `[task:<id>]` / `[voice:<id>]` markers rendered as tap-able citation chips — the trust primitive (see `principles.md`).
- **Voice fan-out:** a spoken note becomes extracted matters via the background transcriber.

## Build & distribution

- **Local dev:** `npm run dev` (browser — where you live).
- **Static export:** `npm run build` → `out/`.
- **Native:** `npx cap sync` → `npx cap run ios` / `npx cap run android` (required before claiming "done" on any native-plugin feature).
- **Distribution path:** web/PWA first → PWABuilder TWA for Android → Capacitor wrap for iOS native push/background. See `ARCHITECTURE.md`.

## Hard security rules

- **No secrets in the client.** Anything prefixed `NEXT_PUBLIC_*` is bundled into the JS and public. Real secrets (Gemini key, JWT signing secret, document storage keys) live in `server/.env`, never the client.
- **Auth tokens** use httpOnly cookie / Capacitor Secure Storage in production — never long-lived in `localStorage`.
- **No client-side rate-limit bypasses.** The server enforces limits; the client renders the resulting error.

## How to apply

1. Prefer the chosen tools above. To propose an alternative, name the specific reason and verify it doesn't break a downstream choice.
2. Route any secret through `server/`. Never embed in client code, never via `NEXT_PUBLIC_*`.
3. All remote access goes through `queries/` (TanStack Query) → `lib/api/*`. Never `fetch` in feature code.
4. All forms use RHF + Zod. Schema is the type.
5. Motion is CSS-only, sparing, and never celebratory; honor reduced motion.

Related: [`overview.md`](overview.md), [`principles.md`](principles.md), [`design.md`](design.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`../AGENTS.md`](../AGENTS.md).
