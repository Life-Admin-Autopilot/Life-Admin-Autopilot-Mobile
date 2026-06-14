# Porting Guide — Mo v1 (React Native) → Mo V2 (Next.js + Capacitor)

What carries over from the v1 repo (`C:\Mina\Mo`) and what gets rebuilt. Roughly **~70% of the data/logic/schema layer is portable**; the cost is the RN UI layer and a few platform seams.

## Legend
- **Ports as-is** — copy with no/near-zero change.
- **Minor changes** — same code, swap a platform detail.
- **Rebuild** — RN/Expo-coupled; re-author for web/Capacitor.

## Layer-by-layer

| v1 path | Verdict | Notes |
|---|---|---|
| `types/*` (domain, settings) | **Ports as-is** | Pure TypeScript. |
| `schemas/*` (Zod) | **Ports as-is** | Pure. |
| `queries/*` + `queries/keys.ts` | **Ports as-is** | TanStack Query is universal; no RN/Expo imports. Re-point at the rebuilt `lib/api`. Reuse v1's cache-reconciliation / optimistic-insert / tool-result-sync logic. |
| `lib/date.ts` | **Ports as-is** | Intl-based, pure. |
| `lib/dueLabel.ts` | **Ports as-is** | Pure; keep it (even though `Intl.RelativeTimeFormat` is now safe on web). |
| `lib/colors.ts` (`DOMAIN_INK`) | **Minor** | Pure token map, but **re-derive the values** to the marble/crimson rebrand — the 6 domains become low-chroma stone tints (see `tokens.md`). The shape stays; the colors change. |
| `lib/translateBackendError.ts` | **Ports as-is** | Moves with `ApiError`. |
| `lib/voiceReview.ts` | **Ports as-is** | Pure scoring logic. |
| `lib/logger.ts` | **Ports as-is** | Adapt transport if desired. |
| `lib/*Store.ts` (Zustand: pendingVoice, createTaskSheet, onboardingState, resolvedClarifications) | **Ports as-is** | Zustand works on web. Keep `useShallow` on object/array selectors. |
| `lib/cn.ts` | **Minor** | Keep `clsx`/`tailwind-merge`; drop the NativeWind angle. |
| `lib/api/client.ts` | **Minor** | Same `api()`/`apiBinary()`/`ApiError` shape and 401-refresh flow. Swap the token source from `useSessionStore.getState()` to the web session (cookie/in-memory). |
| `lib/env.ts` | **Minor** | `EXPO_PUBLIC_*` → `NEXT_PUBLIC_*`. |
| `lib/theme/*` | **Minor** | Map NativeWind tokens → Tailwind CSS tokens (see `tokens.md`). |
| `lib/api/baseUrl.ts` | **Rebuild** | Drop `expo-constants`/Metro-host derivation; just read `NEXT_PUBLIC_API_URL`. |
| `lib/auth/sessionStore.ts` | **Rebuild** | Replace Zustand + `expo-secure-store` with httpOnly refresh cookie + in-memory access token (web) / Capacitor Secure Storage (native). |
| `lib/voice/*` (uploadQueue, uploadFromUri, registerBackgroundUpload) | **Rebuild** | Re-author behind one interface: web `MediaRecorder` + native Capacitor audio-recorder plugin. Background upload → Capacitor background runner or upload-on-foreground. |
| `lib/toast.ts` | **Rebuild** | Back with `sonner` (web), same imperative API. |
| `components/**` (all RN screens/components) | **Rebuild** | `<View>/<Pressable>/<Text>` → HTML + Tailwind. This is the bulk of the work. Keep the same component names/contracts from `docs/primitives.md`. |
| `app/**` (Expo Router routes) | **Rebuild** | → Next.js App Router. Route structure/intent carries; implementation is new. |
| `assets/*` | **Ports as-is** | Already copied here. Reference via `next/image`. |
| `server/*` | **Ports as-is** | Already copied (sanitized). Backend is client-agnostic. |

## Suggested rebuild order (de-risk the scary parts first)

1. `create-next-app` + Tailwind tokens (`tokens.md`) + base shadcn/ui primitives.
2. `lib/env.ts`, `lib/api/*`, `lib/auth/*` → prove auth + a real GET against `server/`.
3. Port `types/`, `schemas/`, `queries/`, pure `lib/*` (cheap wins, unblock features).
4. **Voice recorder web spike** — `MediaRecorder` → existing upload endpoint. Highest-risk port; do it early.
5. Rebuild screens surface-by-surface against `docs/design.md` + `primitives.md`.
6. Add Capacitor + native plugins (push, background audio) last.

## Things NOT to copy from v1
- `server/.env` (live secrets) — already excluded; use `.env.example`.
- `node_modules`, `.expo`, `android/`, `ios/` (RN native projects), `metro.config.js`, `babel.config.js`, `app.config.ts`, `nativewind-env.d.ts`, `expo-env.d.ts`, `.maestro/`, `scripts/fresh-android.ps1` — all RN/Expo toolchain.
