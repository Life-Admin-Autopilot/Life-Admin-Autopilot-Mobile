# Aesthetic — the Panda Autopilot

> The visual target for Life Admin Autopilot. Pair with `tokens.md` (exact values)
> and `primitives.md` (component contracts). Tokens win over raw values — always.

## The aesthetic in one sentence

> **Soft lavender and a friendly panda — calm, warm, and a little playful. The
> product feels like a caring companion clearing your admin clutter, not an
> institution or an archive.**

This is a productivity app with a genuine personality: warm, encouraging, a
little cute — but never noisy or childish. The previous "silent sovereign"
marble-and-crimson system (the King) is fully retired.

## The panda

A soft, round, big-eyed panda (`assets/panda/hero-image.png`, `assets/panda/chatbot.png`).
Unlike the old King symbol, the panda **is** a mascot — it waves, it reacts, it has
a face and a personality. It represents warmth and reassurance: an assistant, not
a monument.

**Rules:**
- The panda appears in hero / splash / chat-avatar surfaces, generally centered,
  with soft glow/sparkle accents echoing the reference art.
- Motion is allowed but restrained — a gentle wave, bounce, or blink on key
  moments (task completed, session opened). Nothing frantic, no confetti storms.
- The center create-action (a plus, in purple) is the system's action mark,
  distinct from the panda itself.

## Material & color (tokens, not hex — see `tokens.md`)

- **Lavender** is the primary material: `bg-canvas` (soft lavender) everywhere,
  white `surface` cards, hairline `border` lavender dividers.
- **Purple** (`accent` `#8E7AE0`) is the single working accent: primary action,
  active tab, due/overdue, the plus, key icons. One purple focal point per
  surface; never paint everything purple.
- **Gold** appears **only** on the premium surface, sparingly.
- **Pastel domain tints** (health/home/car/finance/family/pets) give warmth and
  variety without competing with the purple accent.
- **Cozy negative space** — generous but not monumental; the app should feel
  approachable, not cavernous.

## Typography

Rounded, single display family over clean sans (see `tokens.md` for the scale):
- **Comfortaa** (rounded, friendly) — wordmark ("LIFE ADMIN / Autopilot") and all
  display/heading text (greetings, section titles).
- **Inter** (sans) — body, rows, labels, data. Structured and highly readable, with
  tabular numerals on every time / amount / date / count.

Hierarchy comes from **family + scale + space**, not color or weight tricks.

## Layout & composition

- **Warm and composed.** Every screen feels intentional but approachable.
  Comfortable gutters (`px-6`), clear vertical rhythm.
- **Hero pattern:** centered panda → rounded greeting/title → muted `ink`
  subtitle → composed list of matters.
- **Cards:** white `surface`, `rounded-lg` (14), `shadow-card` (a whisper), hairline
  border. Rows are individually-spaced cards, not dense tables.
- **Tab bar:** five slots with the **purple plus center action** (create). Active
  tab is purple; inactive is `ink-subtle`.
- Information is presented clearly and warmly; the panda sits alongside as a
  companion, not a distant symbol.

## Voice

Warm, clear, encouraging. The system **reports status and celebrates small wins**
without being saccharine. Light personality is welcome; avoid corporate stiffness
and avoid excessive exclamation. The product noun is **"tasks"/"matters"**.

> "Good evening, Mina. 5 smaller steps, big calm ahead."
> "4 minutes need your focus. Pick a small win to free your rest — now."
> "Car insurance due today."
> "Task created. Policy attached."

The emotional goal is **relief with a smile**. The system does not create
urgency — it helps the user feel supported in getting through it.

## AI surfaces must not look like AI

Anything the assistant produces — a search answer, a summary, a suggestion — is
just **something the app is telling you**. It gets no special costume. The house
style for machine-generated text is the same as for everything else, and the
tells below are banned because they read as generic-AI-product rather than as Mo.

- ❌ **No sparkle/star/wand icons.** No ✨, no `Sparkles`, no "magic" glyph,
  anywhere. If a surface needs an icon, use one that describes what it actually
  is (a calendar range for a time summary, a magnifier for search).
- ❌ **No UPPERCASE label over an AI answer.** The uppercase `text-label` eyebrow
  is for structural section headers ("TODAY", "THEMES", "SCAN A DOCUMENT") — it
  is a navigational device, not a badge to hang on generated prose.
- ❌ **No "AI"/"Powered by"/"Assistant" branding, no gradient text or borders, no
  shimmer or typewriter effect on results.**
- ❌ **No echoing the user's question back at them** above the answer. It is
  already on screen in the input they typed it into.
- ❌ **No shouted status words** (`HIGH`, `URGENT`) in list rows. Sentence case;
  the tint carries the signal.

- ✅ Answer in a plain sentence, body type, on `accent-soft` — the same soft
  lavender any other informational card uses.
- ✅ Say what was found the way a person would: *"Two renewals next month — your
  gym membership and the car insurance."* Not *"I found 2 matching tasks."*
- ✅ Per-result provenance in one lowercase clause (`related to car insurance
  renewal, due august 8`), so "why is this here?" is answerable without a badge.

The test: cover the content and the surface should be indistinguishable from a
hand-written one. If it only looks like AI because of decoration, remove the
decoration.

## Do / Don't

- ✅ Lavender canvas, white hairline-bordered cards, one purple focal point,
  rounded Comfortaa greeting + muted subtitle, the panda present and expressive
  in hero/chat surfaces, warm encouraging copy.
- ❌ Marble/crimson/gold-as-accent, the King, stiff institutional copy, crowded
  layouts, harsh saturated colors, the panda used as a small decorative icon with
  no personality.
