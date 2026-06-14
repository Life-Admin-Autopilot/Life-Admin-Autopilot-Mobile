# Design Tokens — Life Admin Autopilot ("white marble + crimson")

The canonical token set for the **silent-sovereign** aesthetic (see `aesthetic.md`
for the vibe, `new-direction.md` for the brand brief). White marble is the material
language; deep crimson is the seal; gold is a sparing premium detail. Tokens win
over raw values — **always use the semantic name, never the hex**.

> **Stack note:** the app runs **Tailwind v4** (CSS-first). There is **no
> `tailwind.config.ts`** — tokens are declared in `app/globals.css` inside
> `@theme` blocks, which generates the semantic utilities (`bg-canvas`,
> `text-ink-muted`, `text-display-hero`, `shadow-card`, `text-accent`). Colors are
> declared as `rgb(R G B)` so Tailwind's `/alpha` modifiers work
> (`bg-accent/10`). The hex column below is for reference only.

---

## Colors — declare in `app/globals.css → @theme`

### Surfaces — marble
| Token | RGB | Hex | Use |
|---|---|---|---|
| `canvas` | `243 240 234` | `#F3F0EA` | Page background — warm marble, every screen |
| `canvas-veined` | `236 232 224` | `#ECE8E0` | Cooler marble for hero/section backdrops |
| `surface` | `255 255 255` | `#FFFFFF` | Cards, sheets — white on marble |
| `surface-sunken` | `236 233 227` | `#ECE9E3` | Input fills, insets |
| `border` | `226 221 212` | `#E2DDD4` | Hairline stone dividers (does most separation) |
| `border-strong` | `212 206 194` | `#D4CEC2` | Section separators |

### Ink — carved graphite (never pure black)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `ink` | `28 26 23` | `#1C1A17` | Primary text — warm graphite |
| `ink-muted` | `107 102 94` | `#6B665E` | Secondary text, metadata, **resolved** status |
| `ink-subtle` | `154 149 139` | `#9A958B` | Hints, placeholders |
| `ink-nav` | `122 116 107` | `#7A746B` | Centered nav titles |

### Accent — deep crimson (the seal: authority, urgency, importance)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `accent` | `164 22 26` | `#A4161A` | Primary action, active tab, due/overdue, the cross, icons |
| `accent-pressed` | `127 20 22` | `#7F1416` | Pressed CTA |
| `accent-soft` | `244 226 225` | `#F4E2E1` | Tinted fill — selected chip, overdue-row wash |
| `accent-ink` | `255 255 255` | `#FFFFFF` | Text/glyph on crimson |

### Gold — **premium tier only** (sparing)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `gold` | `176 137 47` | `#B0892F` | Premium hairline / badge — **only on premium surfaces** |
| `gold-soft` | `239 230 210` | `#EFE6D2` | Premium tint |

Gold is reserved for the premium/subscription surface. Do **not** use it as a
general accent — crimson is the only working accent in the core product.

### Status — restrained (the institution does not celebrate)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `danger` | `142 20 24` | `#8E1418` | Destructive confirm (deeper than accent) |
| `danger-soft` | `244 226 225` | `#F4E2E1` | Destructive wash |
| `warning` | `154 107 31` | `#9A6B1F` | "Approaching" — muted amber, never bright |
| `warning-soft` | `241 231 212` | `#F1E7D4` | |
| **resolved / success** | — | — | Render as **`ink-muted`** — no celebratory green |

> "Overdue" and "due today" use **`accent`** (crimson). "Resolved" is stated
> flatly in `ink-muted`. There is no green success color — the system reports
> completion as fact, it does not congratulate.

### Domains — low-chroma stone tints (6 life domains)
Desaturated to sit inside marble; each is a tint `bg` + a darker `ink`.
| Domain | bg RGB / Hex | ink RGB / Hex |
|---|---|---|
| Health | `228 234 229` `#E4EAE5` | `58 74 64` `#3A4A40` |
| Home | `236 229 221` `#ECE5DD` | `90 74 58` `#5A4A3A` |
| Car | `230 230 226` `#E6E6E2` | `69 69 63` `#45453F` |
| Finance | `227 230 236` `#E3E6EC` | `58 66 84` `#3A4254` |
| Family | `236 227 229` `#ECE3E5` | `90 62 68` `#5A3E44` |
| Pets | `232 227 236` `#E8E3EC` | `76 66 86` `#4C4256` |

---

## Typography — serif display + clean sans

Hierarchy comes from **family + scale**, monumental restraint, generous space.
Loaded via `next/font/google` in `app/layout.tsx`, exposed as CSS variables.

| Role | Family | Variable | Notes |
|---|---|---|---|
| Wordmark | **Cinzel** | `--font-wordmark` | Trajan-style caps, letter-spaced — "LIFE ADMIN / AUTOPILOT" only |
| Display / headings | **Cormorant Garamond** | `--font-display` | Elegant serif — greetings, section titles |
| Body / UI | **Inter** | `--font-sans` | Structured, highly readable; tabular nums on time/money/dates |

Drop Nunito entirely — there is no rounded sans in this system.

### Type scale (`--text-*` in `@theme`; size / line-height / weight)
| Token | Family | Size / LH / Weight | Use |
|---|---|---|---|
| `text-wordmark` | Cinzel | 20 / 24 / 600, tracking `0.18em`, UPPERCASE | Brand wordmark |
| `text-display-hero` | Cormorant | 40 / 46 / 600 | Greeting ("Good morning, Alex.") |
| `text-display-md` | Cormorant | 32 / 38 / 600 | Screen titles |
| `text-heading-xl` | Cormorant | 24 / 30 / 600 | Major section titles |
| `text-heading-md` | Cormorant | 20 / 28 / 600 | Card/group titles |
| `text-heading-sm` | Inter | 17 / 24 / 600 | Row titles |
| `text-body` | Inter | 15 / 22 / 400 | Body / subtitle (`text-ink-muted`) |
| `text-body-sm` | Inter | 14 / 20 / 400 | Helper |
| `text-caption` | Inter | 13 / 18 / 400 | Metadata, due times |
| `text-label` | Inter | 12 / 16 / 600, tracking `0.12em`, UPPERCASE | Eyebrows ("DUE TODAY", "LIFE ADMIN") |
| `text-micro` | Inter | 11 / 14 / 500 | Badges |

Italic (Cormorant) is reserved for rare display emphasis, never body. Tabular
numerals (`font-variant-numeric: tabular-nums`, via a `.tabular` class) on every
time / amount / date / count.

---

## Radius — architectural, composed (tighter than the old playful scale)
```
--radius-sm: 6px;    /* small chips, inputs inner */
--radius-md: 10px;   /* buttons */
--radius-lg: 14px;   /* cards (standard) */
--radius-xl: 18px;   /* modals */
--radius-2xl: 22px;  /* sheet top corners */
--radius-pill: 9999px; /* status chips, the center action is a circle */
```
Cards = `lg`. Buttons = `md` (rectangular, not pill — institutional, never bulbous).
The center create-action (the cross) is a **circle**. Status chips = `pill`.

## Spacing
4px base — Tailwind defaults already match (`p-4` = 16px). Lean **generous**:
monumental negative space is part of the brand. Screen gutter `px-6` (24).

## Depth — soft, low, warm-graphite tint (lean on hairlines over elevation)
```
--shadow-card:     0 1px 2px rgb(28 26 23 / 0.04), 0 4px 12px rgb(28 26 23 / 0.05);
--shadow-elevated: 0 8px 28px rgb(28 26 23 / 0.08), 0 2px 6px rgb(28 26 23 / 0.04);
```
No glow, no colored shadow. Hairline `border-border` does most of the separation —
shadows are a whisper, not a lift.

## Motion — calm, deliberate, no celebration
```
--ease-out-expo:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out-quad: cubic-bezier(0.4, 0, 0.2, 1);
--duration-fast: 120ms;  --duration-base: 220ms;  --duration-slow: 360ms;
```
Static-first. CSS `transform`/`opacity` only, sparingly. **No celebratory motion**
(no confetti, no streak pops). The one signature flourish permitted: a slow, subtle
crimson "vein" opacity pulse on the hero king — opacity only, honors
`prefers-reduced-motion`. Never animate layout properties.

---

## Banned (carries + tightened for marble)
No hex literals or Tailwind built-ins (`gray-500`, `red-600`) in components — token
names only. No gradients on body content (hero marble atmospherics only). No
glassmorphism except floating chrome (tab bar, toasts). No pure black or pure-bright
red. No green. No emoji. Meet WCAG AA (4.5:1 body, 3:1 large) — verify crimson on
white and crimson on `accent-soft`.
