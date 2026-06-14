# Life Admin Autopilot — Visual Design System

> The component-level design language for the app (Next.js + Tailwind v4 + shadcn/ui,
> wrapped by Capacitor). **Exact token values live in [`tokens.md`](tokens.md)** — this
> doc references them by name, never re-tabulates hexes. Aesthetic vibe is in
> [`aesthetic.md`](aesthetic.md); the brand brief is [`new-direction.md`](new-direction.md).
> Where prose and tokens disagree, `tokens.md` + the live `app/globals.css` win.

## The aesthetic in one sentence

> **White marble and deep crimson — a monumental, institutional calm. Serif greetings,
> hairline-bordered white cards on warm marble, one crimson focal point per surface,
> and generous negative space. It feels like a royal archive, not a startup app.**

## Lead references

| Surface family | Reference |
|---|---|
| Whole-product feel | `assets/brand/king.png` — the silent sovereign; marble + crimson veins |
| Home / dashboard composition | `assets/screenshots/home-reference.png` — wordmark + cross, serif greeting, matter rows |
| Material & restraint | monumental architecture, marble sculpture, royal seals, ancient institutions |

Shared grammar: marble as the material, crimson as the only accent, serif as the
emotional anchor, massive negative space, the King as a background symbol (never chrome).

---

## Color

See [`tokens.md`](tokens.md) for values. Rules:

- **Canvas is warm marble (`bg-canvas`)** on every screen; cards are white `surface` with
  a hairline `border` and a whisper `shadow-card`.
- **Crimson (`accent`) is the single working accent** — primary action, active tab,
  due/overdue, the cross, key icons. **One crimson focal point per surface.**
- **Ink is carved graphite** (`ink` / `ink-muted` / `ink-subtle`), never pure black.
- **Domains** use low-chroma stone tints (`domain-*`) ONLY on: domain group labels, the
  small icon chip in a matter row, and domain selector chips. Never full-screen, never on
  text bodies. No emoji — domain identity is a `DomainIcon`, not an emoji.
- **Status is restrained:** overdue/due = `accent` (crimson); approaching = `warning`
  (muted amber); **resolved = `ink-muted`, there is no green.**
- **Gold is premium-tier only** — never a general accent.

### Banned color rules
- ❌ Hex literals or Tailwind built-ins (`gray-500`, `red-600`) in components — token names only.
- ❌ More than one crimson focal point competing on a surface.
- ❌ Domain tints used decoratively (gradients, hero blobs).
- ❌ Pure black text (use `ink`), bright red, or any green.

---

## Typography

Families and the full scale are in [`tokens.md`](tokens.md): **Cinzel** (wordmark only),
**Cormorant Garamond** (serif display — greetings, section titles), **Inter** (body, rows,
labels, data). Loaded via `next/font/google` in `app/layout.tsx`.

Rules:
- Hierarchy comes from **family + scale + space**, not color tricks or weight soup.
- Serif (`font-display`) for greetings/titles; Inter for everything functional.
- **Tabular numerals** (`.tabular`) on every time / amount / date / count.
- Cormorant italic is a rare display-only emphasis — never body, never the user's content.
- Never `text-[15px]` arbitrary literals — extend the `@theme` scale instead.

---

## Spacing, radius, depth, motion

All values in [`tokens.md`](tokens.md). Principles:

- **Spacing** — 4px base (Tailwind defaults match). Lean **generous**; monumental negative
  space is part of the brand. Screen gutter `px-6`.
- **Radius** — architectural and composed: cards `rounded-lg` (14), buttons `rounded-md`
  (10, rectangular — never a pill), sheets `rounded-2xl` (22), status chips `rounded-pill`,
  the center create-action is a **circle**.
- **Depth** — `shadow-card` is a whisper; hairline `border-border` does most separation.
  No glow, no colored shadow, no hard Material elevation.
- **Motion** — static-first; CSS `transform`/`opacity` only, sparingly; **no celebration**
  (no confetti/streak pops). The one permitted flourish is a slow crimson-vein opacity
  pulse on the hero King. Always honor `prefers-reduced-motion`. Never animate layout
  properties (`width`, `height`, `margin`, `padding`).

---

## Component patterns

Reskinned for marble/crimson/serif and institutional voice. Extend this catalog rather
than inventing one-off treatments.

### 1. Date / greeting header (home)
- Centered. Wordmark ("LIFE ADMIN / AUTOPILOT", `text-wordmark` Cinzel) + crimson cross above.
- Greeting: `text-display-hero` Cormorant, `ink` — `Good morning, Alex.`
- Status line beneath: `text-body`, `ink-muted`, counts in `accent` — `5 matters require attention.`
- Generous `space-8` above, `space-6` below.

### 2. Domain group label
- UPPERCASE `text-label` (Inter, tracked) in `domain-{name}-ink`, with a 14px `DomainIcon`
  and a count — e.g. `HEALTH · 4`. Sits on `canvas`, no card. No emoji.

### 3. Matter row (the core list unit)
- Card: white `surface`, `rounded-lg`, `px-4 py-3`, hairline `border`, `shadow-card`.
- Layout: leading `DomainIcon` chip (36px, `domain-{name}` tint) · title block (flex-1) · trailing state/chevron.
- **Title:** `text-heading-sm` (Inter 600), `ink`. **Subtitle:** `text-caption`, `ink-muted`
  (`Due today · 10:00 AM`, `from policy.pdf`). Due/overdue times render in `accent`.
- **Overdue:** a `text-micro` UPPERCASE `OVERDUE` chip in `accent` on `accent-soft`.
- Completion is stated, not celebrated: the row drops to `ink-muted`, no confetti.

### 4. AI activity (quiet, invisible)
- The system "simply knows" — AI presence is understated. A `surface` card, `rounded-lg`,
  no glow. Step title `text-heading-sm` + factual progress (`14 / 50`, `text-caption`).
- Tool-call rows: lucide outline icon (`search`, `globe`, `file-text`, `terminal`) + `text-body-sm`.
- **No sparkle/wand/bot "magic" icons** anywhere — they don't fit the institution.
- Wait state: factual, `warning` text on `warning-soft`, dashed `border-strong` — `Awaiting your reply to continue.`

### 5. Voice / record control
- A restrained **crimson** control (circle or pill), not a mascot, not a beige badge.
- Idle: `Speak.` placeholder (`text-body`, `ink-subtle`). Recording: a calm bar meter
  (CSS, `transform` only) — no bouncing waveform spectacle. Stop = crimson square.
- Transcribed text fades in above in `text-display-md` Cormorant.
- All recorder lifecycle hides behind `lib/voice` (see LESSONS — model it as a state machine).

### 6. Document tile (vault)
- 1:1 tile, `rounded-lg`, white `surface`, `p-4`, hairline border.
- Centered `DomainIcon`/document glyph (crimson or `ink`), 56–80px. Label below: `text-caption`,
  `ink-muted`. Focus = `border-strong` ring.

### 7. Citation chip (the trust primitive — required)
- Inline pill, `px-2 py-0.5`, `rounded-md`, white `surface`, hairline `border`.
- 12px source icon + `text-caption` (`policy.pdf · p.2`) + tap-out arrow. Opens the source
  viewer with the cited segment highlighted.
- **Required wherever AI surfaces a value** (dates, amounts, policy numbers, names). Below
  the confidence threshold, render in `warning` tone and **ask instead of guessing**.
  A surface that shows an AI value without provenance is **not done** (see `principles.md`).

### 8. Briefing card
- Greeting `text-display-md` Cormorant (`Good morning, Alex.`); status `text-body`, `ink-muted`
  (`3 overdue. 5 due today. 2 approaching.` — counts in `accent`).
- Numbered top matters: numeral in `ink-subtle`, title `text-heading-sm`, domain label beneath.
- Footer action: `View all matters` → `/matters`.

### 9. Tab bar — `TabBar` with the crimson cross
- **One** tab bar everywhere (no platform split). A calm white floating surface, `rounded-pill`,
  `shadow-card` — **not glass**. Five slots: Dashboard · Tasks/Matters · **center cross
  (create)** · Documents · Profile.
- **Center action** = a crimson **circle with the cross** (the system's action mark) — raised
  slightly, the focal element. Tapping it opens the create/voice flow.
- Active tab: icon + label in `accent`. Inactive: `ink-subtle`. The active indicator animates
  by `translateX` only (`SPRING_SOFT`-equivalent CSS), honoring reduced motion.
- Icon map (lucide outline): Dashboard → `LayoutGrid`/`House`, Matters → `ListChecks`,
  Documents → `FileText`, Profile → `User`. Center → the custom crimson cross SVG.
- Tab-route screens pad `paddingBottom` by the bar height so content clears it.

### 10. Empty state
- Restrained: hairline (not dashed-playful) `border-strong`, `rounded-lg`, centered
  `text-body-sm`, `ink-muted` — stated factually (`No matters due today.`). Larger empties may
  center the King with monumental space, a serif line, and one crimson action.

---

## Glass — floating chrome only

Translucent surfaces are reserved for **floating chrome** (sheets, toasts). The spine —
cards, matter rows, tiles, the tab bar — stays flat marble/white. Never glass on content
surfaces, full-screen backgrounds, or the King.

---

## Iconography

- **Library:** [lucide-react](https://lucide.dev) — outline icons. Sizes 16/18/20/24.
  Color `ink`/`ink-muted` for passive, `accent` (crimson) for active/important.
- **The cross** (crimson) is the system action/brand mark — center create-action; not a generic icon.
- **The King** is a symbol, hero-only — never an icon, never small, never animated playfully.
- **No emoji**, anywhere. **No "magic" sparkle/wand/bot icons** — AI is invisible here.
- **Domain identity** = `DomainIcon` (stone tint + crimson/ink glyph), driven by `DOMAIN_INK`
  in `lib/colors.ts`.
- **Third-party brand logos** use the real mark under `assets/logo/{name}.webp`, explicit w/h.

---

## Banned patterns (project-wide)
- ❌ Gradients on body content (hero marble atmospherics only).
- ❌ Glass/blur on cards, content, or full-screen backgrounds (floating chrome only).
- ❌ Glow, neon, hard drop-shadow over text, any green, bright red, emoji.
- ❌ Celebration motion (confetti, streak pops, success bursts).
- ❌ Animating layout properties — `transform`/`opacity` only.
- ❌ Hex literals or Tailwind built-ins in components — token names only.
- ❌ Raw IDs surfaced to the user — render a human-readable name.
- ❌ Native browser dialogs (`alert()`/`confirm()`) — use the toast/dialog primitives.
- ❌ Exclamation marks, motivational copy, chatty/friendly tone (see `principles.md` → voice).

---

## Implementation: tokens & fonts (Tailwind v4 + next/font)

- **Tokens live in `app/globals.css`** inside `@theme` blocks (Tailwind v4 is CSS-first —
  **there is no `tailwind.config.ts`**). Colors are `rgb(R G B)` so `/alpha` modifiers work.
  Adding a token = add the `--color-*` / `--text-*` / `--radius-*` line and (for shadcn
  semantic mapping) the `:root` var. Keep `tokens.md` in sync in the same change.
- **Fonts** load via `next/font/google` in `app/layout.tsx`:
  ```ts
  import { Cinzel, Cormorant_Garamond, Inter } from 'next/font/google'
  const cinzel = Cinzel({ subsets: ['latin'], weight: ['600','700'], variable: '--font-wordmark' })
  const cormorant = Cormorant_Garamond({ subsets: ['latin'], weight: ['500','600'], style: ['normal','italic'], variable: '--font-display' })
  const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })
  // apply all three variables on <html>, map --font-sans/--font-display/--font-wordmark in globals @theme
  ```
- shadcn primitives consume their semantic vars (`--primary`, `--card`…) which `globals.css`
  maps onto Mo tokens (`--primary` = crimson). Restyle the primitives' radius/height to the
  marble scale (buttons `rounded-md`, hairline borders).

## How to apply this when building
1. Read [`aesthetic.md`](aesthetic.md) and look at `assets/screenshots/home-reference.png` for the surface you're building.
2. Find the matching pattern above; if none fits, add one here before writing the component.
3. Token names only — extend the `@theme` scale rather than inlining a value.
4. Build and verify in the browser (`npm run dev`) against the reference; the institution must read as calm, certain, and uncrowded.

## Maintenance
This file is the component-level source of truth; `tokens.md` is the value-level source of
truth. If a review surfaces drift, fix the build to match these docs (never the reverse,
unless we are deliberately evolving the system) and update both docs in the same change.
