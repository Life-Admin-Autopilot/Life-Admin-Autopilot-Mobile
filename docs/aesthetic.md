# Aesthetic — the Silent Sovereign

> The visual target for Life Admin Autopilot. Pair with `tokens.md` (exact values)
> and `primitives.md` (component contracts). The brand brief is `new-direction.md`;
> this doc turns it into a buildable spec. Tokens win over raw values — always.

## The aesthetic in one sentence

> **White marble and deep crimson — a monumental, institutional calm. The product
> feels like a royal archive, not a startup app: timeless, certain, restrained.**

This is **not** a productivity app, a friendly assistant, or a playful task manager.
It is an **institution** — a permanent presence that brings order to complexity. It
communicates authority, clarity, structure, and calm confidence. The old warm-cream /
indigo / Nunito / mascot system is fully retired.

## The silent sovereign (the King)

A weathered **white-marble sovereign seated upon a throne** (`assets/brand/king.png`).
His face is hidden; his expression unknowable. Cracks of **crimson energy** run
through the marble — immense power and awareness beneath stillness.

He is **a symbol, not a mascot.** He has no emotions, jokes, or personality. He does
not wave, celebrate, or react. He represents the system itself: memory, judgment,
responsibility, permanence. He remembers what the user does not.

**Rules:**
- The King appears **only** in hero / splash / empty-state surfaces, centered, with
  monumental negative space around him. Never as chrome, never small, never an icon.
- He is **never animated playfully**. The only motion permitted is a slow, subtle
  crimson-vein opacity pulse (see `tokens.md → Motion`), and even that is optional.
- The **cross** (crimson) is the system's action mark — it is the center
  create-action and the brand glyph, distinct from the King himself.

## Material & color (tokens, not hex — see `tokens.md`)

- **Marble** is the primary material: `bg-canvas` (warm marble) everywhere, white
  `surface` cards, hairline `border` stone dividers.
- **Crimson** (`accent` `#A4161A`) is the seal — importance, urgency, authority. It
  is the single working accent: primary action, active tab, due/overdue, the cross,
  key icons. One crimson focal point per surface; never paint everything red.
- **Gold** appears **only** on the premium surface, sparingly — a subtle mark of
  craftsmanship, never a general accent.
- **No green, no celebration color.** "Resolved" is stated in `ink-muted`.
- **Massive negative space** signals confidence and restraint. Nothing crowded,
  busy, playful, or decorative.

## Typography

Monumental serif over clean sans (see `tokens.md` for the scale):
- **Cinzel** (caps, letter-spaced) — the "LIFE ADMIN / AUTOPILOT" wordmark only.
- **Cormorant Garamond** (serif) — greetings and section titles. Elegant, timeless.
- **Inter** (sans) — body, rows, labels, data. Structured and highly readable, with
  tabular numerals on every time / amount / date / count.

Hierarchy comes from **family + scale + space**, not color or weight tricks.

## Layout & composition

- **Deliberate and composed.** Every screen feels intentional; the user is never
  overwhelmed. Generous gutters (`px-6`), large vertical rhythm, content allowed to
  breathe.
- **Hero pattern:** centered King (or wordmark + cross) → serif greeting/title →
  muted `ink` subtitle → composed list of matters. Mirrors `assets/screenshots/home-reference.png`.
- **Cards:** white `surface`, `rounded-lg` (14), `shadow-card` (a whisper), hairline
  border. Rows are individually-spaced cards, not dense tables — but never busy.
- **Tab bar:** five slots with the **crimson cross center action** (create). Active
  tab is crimson; inactive is `ink-subtle`.
- Information is presented "with confidence and precision." Tasks/matters, reminders,
  and documents are the focus; the King sits in the background as a symbol.

## Voice (see `principles.md` → Institutional voice)

Concise, direct, authoritative. The system **states facts, reports status, executes
requests.** Never excited, cheerful, or conversational. No motivational language, no
emoji, no exclamation marks, no unnecessary words. The product noun is **"matters."**

> "Good morning, Alex. 5 matters require attention."
> "Car insurance expires in 3 days."
> "Task created. Policy attached."
> "3 overdue. 5 due today. 2 approaching."
> "Speak once. Order follows."

The emotional goal is **relief**, not productivity. The system does not create
urgency — it **absorbs** it. Every interaction should leave the user feeling that
order has been restored.

## Do / Don't

- ✅ Marble canvas, white hairline-bordered cards, one crimson focal point, monumental
  serif greeting + muted subtitle, the King centered in hero with space around him,
  factual institutional copy.
- ❌ Warm pastels, indigo, rounded mascots, bright red or green, glow/confetti/celebration,
  exclamation marks, emoji, crowded layouts, the King as a small decorative icon or an
  emotive character, gold used as a general accent.
