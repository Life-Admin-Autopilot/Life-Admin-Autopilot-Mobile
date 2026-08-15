# Kitto — Life Admin Autopilot (Next.js + Capacitor)

> **Status: foundation built.** The Next.js app is scaffolded (Next 16 + React 19 + **Tailwind v4** + shadcn/ui), the platform seams are wired (`lib/api`, `lib/auth`, TanStack Query), and a live `/health` round-trip against the backend is verified. The product is **Kitto**, on the **soft-planner** design system with the ghost mascot (`assets/ghost/`). Two earlier identities are retired and their docs are marked as such: the "white marble + crimson" silent sovereign (the *King*) and the lavender *panda* / *Mo* system.

## What this is

Kitto v1 was a React Native / Expo app. The native toolchain (Android emulator mic, adb, build scripts) caused most of the friction — not React itself. Since the owner is a Next.js/web expert, we're rebuilding on **Next.js (static export) + Capacitor**, which keeps the native capabilities that matter (native push, foreground-started background audio) while giving web-speed iteration. Full rationale in [`docs/PLATFORM-DECISION.md`](docs/PLATFORM-DECISION.md).

## What's in here

| Path | What |
|---|---|
| [`AGENTS.md`](AGENTS.md) | The rules for any AI/dev working in this repo. **Read first.** |
| [`server/`](server/) | The Express + MongoDB backend, copied from v1 and **sanitized** (no real `.env`, no `node_modules`). Reusable almost as-is. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Target Next.js + Capacitor structure, data flow, deployment path. |
| [`docs/PORTING-GUIDE.md`](docs/PORTING-GUIDE.md) | Which v1 code layers port as-is vs. need rebuilding. |
| [`docs/PLATFORM-DECISION.md`](docs/PLATFORM-DECISION.md) | Why Next.js + Capacitor, with the researched iOS/PWA/Capacitor constraints. |
| [`docs/LESSONS.md`](docs/LESSONS.md) | Hard-won lessons from v1 (why animations were removed, the trust contract, voice-recorder gotchas, etc.). |
| [`docs/new-direction.md`](docs/new-direction.md) | ⚠️ **RETIRED** — the silent-sovereign brand brief. Kept for history only. |
| [`docs/tokens.md`](docs/tokens.md) | ⚠️ **RETIRED** — the lavender/panda token set. The live tokens are the `@theme` block in `app/globals.css`. |
| [`docs/principles.md`](docs/principles.md) | Product voice + principles. **Current.** |
| `docs/*` (aesthetic.md, design.md, primitives.md, …) | ⚠️ Mostly **retired** brand-era docs — each carries a banner. Read `app/globals.css` and `AGENTS.md` for the live system. |
| [`assets/`](assets/) | `ghost/` (the mascot), `screenshots/`, logos, fonts. |

## Where the build is

Done: `create-next-app` (Next 16, App Router, TS, **Tailwind v4 — CSS-first `@theme`, no `tailwind.config.ts`**), shadcn/ui primitives, the platform seams (`lib/env`, `lib/api/*`, `lib/auth/sessionStore`, `lib/toast`), TanStack Query providers, and a verified `/health` round-trip.

Next:
1. **Reskin the foundation to the marble/crimson tokens** — `app/globals.css` (`@theme`), fonts in `app/layout.tsx` (Cinzel/Cormorant/Inter via `next/font`), and the dev surfaces. See [`docs/tokens.md`](docs/tokens.md) / [`docs/aesthetic.md`](docs/aesthetic.md).
2. Port the framework-agnostic layers (`queries/`, `types/`, `schemas/`, pure `lib/`) from v1.
3. Build auth (login UI + authenticated `GET /auth/me`), then feature screens against [`docs/design.md`](docs/design.md) + [`docs/primitives.md`](docs/primitives.md).
4. Add Capacitor (`npm i @capacitor/core @capacitor/cli && npx cap init`) once the web app feels right.

## Running everything

```bash
npm run app
```

Backend + site + phone, one command. Picks the native target from the host OS —
macOS opens Xcode, everything else opens Android Studio — wires the phone to the
local backend over the LAN, and live-reloads from the dev server. Add `--web` for
the site alone.

**New machine?** Start at [`docs/SETUP.md`](docs/SETUP.md) — it covers both
repos, where they go, and the prerequisites. For how the native pipeline works,
see [`docs/CAPACITOR.md`](docs/CAPACITOR.md#one-command-npm-run-app).

## Running the backend

The backend is intact. To run it:
```bash
cd server
cp .env.example .env   # then fill in real values (Mongo URI, JWT secrets, Gemini/Resend keys)
npm install
npm run dev
```

> The real v1 `.env` (live secrets) was intentionally **not** copied. Generate fresh secrets here.
