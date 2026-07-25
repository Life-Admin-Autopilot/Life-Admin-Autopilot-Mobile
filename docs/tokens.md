# Design Tokens — Life Admin Autopilot ("lavender + panda")

The canonical token set for the **panda-autopilot** aesthetic (see `aesthetic.md`
for the vibe). Soft lavender is the material language; a friendly purple is the
accent; gold is a sparing premium detail. Tokens win over raw values — **always
use the semantic name, never the hex**.

> **Stack note:** the app runs **Tailwind v4** (CSS-first). There is **no
> `tailwind.config.ts`** — tokens are declared in `app/globals.css` inside
> `@theme` blocks, which generates the semantic utilities (`bg-canvas`,
> `text-ink-muted`, `text-display-hero`, `shadow-card`, `text-accent`). Colors are
> declared as `rgb(R G B)` so Tailwind's `/alpha` modifiers work
> (`bg-accent/10`). The hex column below is for reference only.

---

## Colors — declare in `app/globals.css → @theme`

### Surfaces — lavender
| Token | RGB | Hex | Use |
|---|---|---|---|
| `canvas` | `245 242 251` | `#F5F2FB` | Page background — soft lavender, every screen |
| `canvas-veined` | `238 233 249` | `#EEE9F9` | Slightly deeper lavender for hero/section backdrops |
| `surface` | `255 255 255` | `#FFFFFF` | Cards, sheets — white on lavender |
| `surface-sunken` | `237 231 249` | `#EDE7F9` | Input fills, insets |
| `border` | `228 221 242` | `#E4DDF2` | Hairline lavender dividers (does most separation) |
| `border-strong` | `210 199 235` | `#D2C7EB` | Section separators |

### Ink — plum-charcoal (never pure black)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `ink` | `45 42 61` | `#2D2A3D` | Primary text — deep plum-charcoal |
| `ink-muted` | `107 100 130` | `#6B6482` | Secondary text, metadata, **resolved** status |
| `ink-subtle` | `150 143 173` | `#968FAD` | Hints, placeholders |
| `ink-nav` | `130 122 158` | `#827A9E` | Centered nav titles |

### Accent — soft purple (the panda's ribbon)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `accent` | `142 122 224` | `#8E7AE0` | Primary action, active tab, due/overdue, the plus, icons |
| `accent-pressed` | `111 90 194` | `#6F5AC2` | Pressed CTA |
| `accent-soft` | `232 225 250` | `#E8E1FA` | Tinted fill — selected chip, overdue-row wash |
| `accent-ink` | `255 255 255` | `#FFFFFF` | Text/glyph on purple |

### Gold — **premium tier only** (sparing)
| Token | RGB | Hex | Use |
|---|---|---|---|
| `gold` | `176 137 47` | `#B0892F` | Premium hairline / badge — **only on premium surfaces** |
| `gold-soft` | `239 230 210` | `#EFE6D2` | Premium tint |

Gold is reserved for the premium/subscription surface. Do **not** use it as a
general accent — purple is the only working accent in the core product.

### Status — soft but legible
| Token | RGB | Hex | Use |
|---|---|---|---|
| `danger` | `194 58 58` | `#C23A3A` | Destructive confirm |
| `danger-soft` | `250 230 230` | `#FAE6E6` | Destructive wash |
| `warning` | `178 122 40` | `#B27A28` | "Approaching" — warm amber |
| `warning-soft` | `250 238 217` | `#FAEED9` | |
| **resolved / success** | — | — | Render as **`ink-muted`**, or a soft mint accent in celebratory contexts (e.g. task-complete toasts) |

> "Overdue" and "due today" use **`accent`** (purple). "Resolved" is stated
> in `ink-muted` by default — friendly, not clinical.

### Domains — pastel tints on lavender (6 life domains)
Each is a tint `bg` + a darker `ink`, tuned to sit warmly against the lavender canvas.
| Domain | bg RGB / Hex | ink RGB / Hex |
|---|---|---|
| Health | `226 241 231` `#E2F1E7` | `42 92 66` `#2A5C42` |
| Home | `246 231 219` `#F6E7DB` | `120 82 48` `#785230` |
| Car | `226 229 238` `#E2E5EE` | `62 68 92` `#3E445C` |
| Finance | `221 232 247` `#DDE8F7` | `42 74 122` `#2A4A7A` |
| Family | `248 224 232` `#F8E0E8` | `122 48 76` `#7A304C` |
| Pets | `234 224 248` `#EAE0F8` | `92 56 140` `#5C388C` |

---

## Typography — rounded, friendly, single display family

Hierarchy comes from **family + scale**, warm and approachable, generous space.
Loaded via `next/font/google` in `app/layout.tsx`, exposed as CSS variables.

| Role | Family | Variable | Notes |
|---|---|---|---|
| Wordmark | **Comfortaa** | `--font-wordmark` | Rounded, chunky, hand-drawn feel — "LIFE ADMIN / Autopilot" |
| Display / headings | **Comfortaa** | `--font-display` | Same rounded family — greetings, section titles |
| Body / UI | **Inter** | `--font-sans` | Structured, highly readable; tabular nums on time/money/dates |

### Type scale (`--text-*` in `@theme`; size / line-height / weight)
| Token | Family | Size / LH / Weight | Use |
|---|---|---|---|
| `text-wordmark` | Comfortaa | 20 / 24 / 600, tracking `0.18em`, UPPERCASE | Brand wordmark |
| `text-display-hero` | Comfortaa | 40 / 46 / 600 | Greeting ("Good evening, Mina.") |
| `text-display-md` | Comfortaa | 32 / 38 / 600 | Screen titles |
| `text-heading-xl` | Comfortaa | 24 / 30 / 600 | Major section titles |
| `text-heading-md` | Comfortaa | 20 / 28 / 600 | Card/group titles |
| `text-heading-sm` | Inter | 17 / 24 / 600 | Row titles |
| `text-body` | Inter | 15 / 22 / 400 | Body / subtitle (`text-ink-muted`) |
| `text-body-sm` | Inter | 14 / 20 / 400 | Helper |
| `text-caption` | Inter | 13 / 18 / 400 | Metadata, due times |
| `text-label` | Inter | 12 / 16 / 600, tracking `0.12em`, UPPERCASE | Eyebrows ("DUE TODAY", "LIFE ADMIN") |
| `text-micro` | Inter | 11 / 14 / 500 | Badges |

Tabular numerals (`font-variant-numeric: tabular-nums`, via a `.tabular` class) on
every time / amount / date / count.

---

## Radius — soft, rounded (the panda's plushness carries into the shapes)
```
--radius-sm: 6px;    /* small chips, inputs inner */
--radius-md: 10px;   /* buttons */
--radius-lg: 14px;   /* cards (standard) */
--radius-xl: 18px;   /* modals */
--radius-2xl: 22px;  /* sheet top corners */
--radius-pill: 9999px; /* status chips, the center action is a circle */
```
Cards = `lg`. Buttons = `md`. The center create-action (the plus) is a **circle**.
Status chips = `pill`.

## Spacing
4px base — Tailwind defaults already match (`p-4` = 16px). Lean generous but
cozy rather than monumental. Screen gutter `px-6` (24).

## Depth — soft, low, cool-plum tint
```
--shadow-card:     0 1px 2px rgb(45 42 61 / 0.04), 0 4px 12px rgb(45 42 61 / 0.05);
--shadow-elevated: 0 8px 28px rgb(45 42 61 / 0.08), 0 2px 6px rgb(45 42 61 / 0.04);
```
No glow, no colored shadow. Hairline `border-border` does most of the separation —
shadows are a whisper, not a lift.

## Motion — calm, deliberate, but allowed a little joy
```
--ease-out-expo:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out-quad: cubic-bezier(0.4, 0, 0.2, 1);
--duration-fast: 120ms;  --duration-base: 220ms;  --duration-slow: 360ms;
```
Static-first. CSS `transform`/`opacity` only, sparingly. A small celebratory
flourish is permitted on task completion (a gentle bounce/wave from the panda) —
honors `prefers-reduced-motion`. Never animate layout properties.

---

## Banned
No hex literals or Tailwind built-ins (`gray-500`, `red-600`) in components — token
names only. No harsh gradients on body content. No glassmorphism except floating
chrome (tab bar, toasts). No pure black. Meet WCAG AA (4.5:1 body, 3:1 large) —
verify purple on white and purple on `accent-soft`.
