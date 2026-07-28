# Life Admin Autopilot — Guiding Principles

## Single product test

Every feature, every screen, every decision must answer one question:

> **Does this make life admin feel less stressful, not more?**

If the honest answer is "not really" or "kind of, but…", cut it. We do not ship features that don't pass.

## Feel target

> **Monumental calm — white marble and deep crimson, serif greetings over clean sans, vast negative space, one crimson focal point at a time.**

Certain and composed, never flashy or chatty. Premium and institutional — the product feels like a permanent authority that absorbs complexity rather than a helpful assistant that adds to it. The voice agent, the daily briefing, and the document vault work together so the user feels that *order has been restored*. The emotional goal is **relief**, not productivity.

## The trust contract (the #1 risk we design around)

The pitch names this risk explicitly: the AI extracting the wrong value — wrong renewal date, wrong policy when the user has two cars, "1/12" read as Jan 12 instead of Dec 1. **One wrong reminder loses user trust permanently.** No amount of subsequent correctness rebuilds it.

The design system encodes this trust contract:

- Every AI-derived value renders with a **CitationChip** showing its source ("policy.pdf · p.2"). See `design.md` → component pattern #7.
- When the AI's confidence is below threshold, the value is rendered in `warning` tone and the agent **asks** instead of guessing.
- Source viewers exist for every cited value — tap the chip, see the original document with the cited segment highlighted.
- The agent has explicit wait states ("Continue when you reply") rather than guessing past ambiguity.

If a surface would render an AI-derived value *without* provenance, that surface is not done. No exceptions.

## Scope discipline

When in doubt, build the smallest version that works. Push back on requests that drift into the phase-2 list (see [`overview.md`](overview.md)).

Reasons to push back are not personal. They protect the v1 ship date. Phase 2 work shipped early steals the polish budget from the hero loop, and a half-polished hero loop is the only thing that can actually fail the project.

## Anti-template policy

The frontend output should look intentional, opinionated, and specific to Life Admin Autopilot — never generic. Banned patterns:

- Default Tailwind card grids with uniform spacing.
- Stock hero sections with centered headline + gradient blob + generic CTA.
- Unmodified shadcn/ui defaults shipped as "finished design".
- Flat layouts with no hierarchy or restraint.
- Safe gray-on-white styling with one decorative accent.
- Generic "AI dashboard" patterns (animated orbs, sparkle confetti, glow effects) — doubly banned: the institution never celebrates.

Every meaningful surface must demonstrate at least four of these:

1. Clear hierarchy through family + scale contrast (serif Cormorant display vs. Inter body).
2. Intentional rhythm in spacing — generous, monumental negative space, not uniform padding.
3. Depth through hairline-bordered layered surfaces on marble, not Material elevation.
4. Typography with character — the serif-over-sans voice (Cormorant display, Inter body), never default system fonts.
5. Color used semantically (crimson is functional, never decorative).
6. Focus / active / pressed states that feel designed, not default.
7. Motion that clarifies flow rather than entertaining — and never celebrates.
8. Data presented with institutional precision (tabular numerals, factual status).

## Warm, not chatty — the voice of Kitto

The assistant is **Kitto**: a small round panda who handles your life admin. Warm and genuinely competent, both at once — cute, not silly; friendly, not fawning. It says what it did, offers the next move, and gets out of the way. The product noun is **"matters"** (not "tasks"). The emotional goal is **relief with a smile**, not productivity theatre.

The full persona lives in `server/src/modules/ai/voice/systemPrompt.ts` (preamble), `voice/toolRules.ts` → VOICE (rules), and `voice/prefill.ts` (few-shot style precedent). Those three must stay in agreement — the prefill is style precedent the model actually copies, so changing the rules without the examples does nothing.

- **Short and warm beats long and nice.** `Added it — Tuesday at 9.` / `That's three for today.` Never open with a compliment; open with the answer. No filler, no warm-up paragraph, no sign-off.
- **A small nod, not a parade.** A completion gets one warm beat and then moves on: `Done — that's Health clear for today.` Never congratulate twice, and never celebrate merely filing something.
- **Punctuation stays calm.** At most one emoji per message and only where it lands (a greeting, a completion) — most replies have none. At most one exclamation mark, rarely. The warmth is in the word choice.
- **Absorb stress, never manufacture or scold.** `Rent's due tomorrow and it's marked urgent — want it at the top of your day?` No dramatizing, no over-reassurance, and **no guilt-tripping** — an overdue matter is just a date that passed.
- **Drop redundant labels.** If the heading + placeholder already explain the field, don't stack a label on top. One signal per field.
- **Errors are plain and kind, not chummy or raw.** `That document didn't load. Try again?` — never `Error 503: upstream timeout`, and never a fake-cheery apology.
- **Buttons commit to verbs.** `Create matter` / `Attach document` / `Resolve` — not `Submit`, `OK`, `Continue` unless that's genuinely the right action.
- **Soften the chrome with space, not decoration.** Avoid nested bordered boxes ("card-in-a-card"). Use whitespace, a hairline divider, or a tinted icon chip.
- **One accent per surface.** Purple is the focal action. Don't paint every action purple — a secondary action is `ghost`/`outline`.

## How to apply

When evaluating any proposal — new feature, abstraction, library, design flourish — run it through these tests in order:

1. **Single product test:** Does this make life admin feel less stressful?
2. **Scope discipline:** Is this v1 or phase 2? (Check `overview.md`.)
3. **Trust contract:** If it touches AI output, does it carry provenance?
4. **Anti-template:** Will the result look like a deliberate product, not a generic AI app?
5. **Smallest version that works:** What's the minimum that proves the value?

If a proposal fails any of these, name the conflict explicitly and offer the version that passes.

Related: [`overview.md`](overview.md), [`design.md`](design.md), [`aesthetic.md`](aesthetic.md), [`new-direction.md`](new-direction.md).
