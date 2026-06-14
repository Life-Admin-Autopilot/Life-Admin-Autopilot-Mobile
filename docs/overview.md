# Life Admin Autopilot — Overview

Life Admin Autopilot is an AI-powered cross-platform app (web/PWA + iOS + Android via Next.js + Capacitor) that turns daily life admin into a voice-first AI agent. The user speaks naturally, and the system creates the matters, sets the reminders, and attaches the right documents — automatically. It is positioned not as a friendly assistant but as an **institution**: a permanent authority that absorbs life-admin complexity. The emotional goal is relief — order restored. See `new-direction.md` / `aesthetic.md`.

## One-line pitch

A voice-first AI agent that handles your entire life admin — insurance, car, bills, school, warranties, documents — with a single spoken sentence.

## Target users

Working adults, parents, and expats managing recurring life-admin tasks across six domains (Health, Home, Car, Finance, Family, Pets) who want a hands-free way to stay organized.

## The differentiator

Task apps only store what the user types. General AI assistants don't understand documents or life admin. Life Admin Autopilot is the only product combining a voice-first AI agent, real document understanding, and life-admin domain knowledge in one autonomous loop — on iOS and Android.

## v1 scope (the hero loop)

Four features prove the core value end-to-end:

- **Voice-First AI Agent** — one spoken sentence becomes multiple linked tasks. The hero. Everything else feeds this.
- **AI Copilot Chat** — **shipped.** A conversational agent (`app/chat.tsx`) with tool calling — create / update / complete / delete / snooze / query tasks, each state-changing call confirmed by the user, with citation chips on referenced tasks/notes.
- **AI Workspace Assignment** — auto-files tasks into the six life domains so the user never picks a category.
- **Document-to-Task Chain** — scanning a document creates linked tasks with extracted dates, amounts, and policy numbers.
- **Daily Briefing** — a clear daily view of what's due, overdue, and coming up.

> **Note on the briefing (honest status):** the *briefing screen ships* as a date-bucketed view of your open tasks (Overdue / Today / This week / Later). The **AI-generated, pre-ranked, pre-generated-at-05:00 digest is NOT built yet** — there is no ranking model and no morning scheduler on the backend. See `features.md` #4.

## Explicitly NOT in v1 (phase 2+)

The pitch lists nine features. The four below are deferred to phase 2:

- AI Notification Timing (smart-time reminder tuning)
- Task Conflict Detection (overlap / contradiction warnings)
- Natural Language Automations ("every month do X")
- Google Calendar two-way sync

Phase 2 ships only after v1 has shipped, been used, and the hero loop is validated. Don't build phase 2 features early "since they're easy" — the cost is the polish that v1 needs.

## Platform priority

- **Web/PWA first, then iOS + Android via Capacitor.** One Next.js codebase (static export) ships to the browser as a PWA, then wraps in Capacitor for the app stores (native push, background audio). See `PLATFORM-DECISION.md` / `ARCHITECTURE.md`.
- **Visual lead is iOS.** Sheets and navigation use iOS idioms; the same web build renders everywhere via the Capacitor shell.
- **Both platforms target real devices for review** — simulator/emulator rendering is not always accurate enough to ship against.

## Why this scope

Six-person team, fixed graduation-project timeline. A focused, shippable product beats a feature-complete clone of every AI assistant on the market. Every cut feature is time bought back for polish on the hero loop.

The biggest accuracy risk in the pitch is the AI extracting a wrong value — wrong renewal date, wrong policy when the user has two cars, "1/12" read as Jan 12 instead of Dec 1. One wrong reminder loses user trust permanently. v1 invests heavily in the **citation primitive** (see `design.md` → CitationChip): every AI-derived value renders with its source. The hero loop above is the minimum surface area where that primitive can be proved end-to-end.

## How to apply

When proposing a feature, change, or scope adjustment:

1. Check against the v1 list above. If it's already in v1, proceed.
2. If it's not, check the phase-2 list. If it's there, push back unless the user explicitly accepts the scope expansion.
3. Run it through the test in [`principles.md`](principles.md): *Does this make life admin feel less stressful, not more?* If not, cut it.
4. Prefer the smallest version that works. We can always add depth later — we can't unship a half-finished surface.

Related: [`principles.md`](principles.md), [`stack.md`](stack.md), [`design.md`](design.md), [`features.md`](features.md).
