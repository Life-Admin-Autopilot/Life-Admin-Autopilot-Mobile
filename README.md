# Mo V2 — Life Admin Autopilot (Next.js + Capacitor)

> **Status: foundation built.** The Next.js app is scaffolded (Next 16 + React 19 + **Tailwind v4** + shadcn/ui), the platform seams are wired (`lib/api`, `lib/auth`, TanStack Query), and a live `/health` round-trip against the backend is verified. The product has rebranded to the **"white marble + crimson" silent-sovereign** direction (see [`docs/new-direction.md`](docs/new-direction.md) / [`docs/aesthetic.md`](docs/aesthetic.md)); the running foundation still needs reskinning to the new tokens.

## What this is

Mo v1 was a React Native / Expo app. The native toolchain (Android emulator mic, adb, build scripts) caused most of the friction — not React itself. Since the owner is a Next.js/web expert, we're rebuilding on **Next.js (static export) + Capacitor**, which keeps the native capabilities that matter (native push, foreground-started background audio) while giving web-speed iteration. Full rationale in [`docs/PLATFORM-DECISION.md`](docs/PLATFORM-DECISION.md).

## What's in here

| Path | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The rules for any AI/dev working in this repo. **Read first.** |
| [`server/`](server/) | The Express + MongoDB backend, copied from v1 and **sanitized** (no real `.env`, no `node_modules`). Reusable almost as-is. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Target Next.js + Capacitor structure, data flow, deployment path. |
| [`docs/PORTING-GUIDE.md`](docs/PORTING-GUIDE.md) | Which v1 code layers port as-is vs. need rebuilding. |
| [`docs/PLATFORM-DECISION.md`](docs/PLATFORM-DECISION.md) | Why Next.js + Capacitor, with the researched iOS/PWA/Capacitor constraints. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | Hard-won lessons from v1 (why animations were removed, the trust contract, voice-recorder gotchas, etc.). |
| [`docs/new-direction.md`](docs/new-direction.md) | **The brand brief** — the silent sovereign. Source of truth for the rebrand. |
| [`docs/tokens.md`](docs/tokens.md) | The full design-token set (marble/crimson), as Tailwind v4 `@theme` in `app/globals.css`. |
| `docs/*` (aesthetic.md, design.md, principles.md, overview.md, primitives.md, …) | Product + design truth. |
| [`assets/`](assets/) | `brand/king.png` (the sovereign), `screenshots/`, logos, fonts. |

## Where the build is

Done: `create-next-app` (Next 16, App Router, TS, **Tailwind v4 — CSS-first `@theme`, no `tailwind.config.ts`**), shadcn/ui primitives, the platform seams (`lib/env`, `lib/api/*`, `lib/auth/sessionStore`, `lib/toast`), TanStack Query providers, and a verified `/health` round-trip.

Next:
1. **Reskin the foundation to the marble/crimson tokens** — `app/globals.css` (`@theme`), fonts in `app/layout.tsx` (Cinzel/Cormorant/Inter via `next/font`), and the dev surfaces. See [`docs/tokens.md`](docs/tokens.md) / [`docs/aesthetic.md`](docs/aesthetic.md).
2. Port the framework-agnostic layers (`queries/`, `types/`, `schemas/`, pure `lib/`) from v1.
3. Build auth (login UI + authenticated `GET /auth/me`), then feature screens against [`docs/design.md`](docs/design.md) + [`docs/primitives.md`](docs/primitives.md).
4. Add Capacitor (`npm i @capacitor/core @capacitor/cli && npx cap init`) once the web app feels right.

## Running the backend

The backend is intact. To run it:
```bash
cd server
cp .env.example .env   # then fill in real values (Mongo URI, JWT secrets, Gemini/Resend keys)
npm install
npm run dev
```

> The real v1 `.env` (live secrets) was intentionally **not** copied. Generate fresh secrets here.
