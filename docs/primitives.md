# Life Admin Autopilot — Component Primitives

> **V2 note (Next.js + Capacitor + new brand).** This doc was written for the React Native build under the old "warm cream + indigo + Nunito + mascot" system. Two things changed: (1) **platform** — contracts are re-implemented on **shadcn/ui (Radix) + Tailwind v4**, not react-native-reusables. Quick re-map: `Pressable`→`<button>`, `View`→`<div>`, RN `TextInput`→shadcn `Input`, `onPress`→`onClick`, `onChangeText`→`onChange`, `GlassSheet`/gorhom→Radix Dialog/Drawer (`vaul`), RN toast→`sonner`, `Image`→`next/image`, Reanimated/Moti→CSS transitions. (2) **brand** — the marble/crimson **silent sovereign** (see `aesthetic.md`): Nunito→**Cormorant/Inter**, indigo→**crimson** (`accent`), the **mascot/`MascotTabBar` is retired** in favor of the **King symbol + the crimson cross center action** (`TabBar`), emoji are gone, and there is **no celebration motion**. The "✅ built / 🟡 not built" statuses refer to v1 and do **not** apply in V2 (nothing is built yet) — read them as design intent. See `AGENTS.md` → Primitives, `tokens.md`, `PORTING-GUIDE.md`.

This is the contract layer — interfaces, props, variants, and visual contracts for the primitives every feature folder consumes. **No implementations** in this doc; just the shapes.

Primitives are the design system materialized as code. If a feature needs a UI element that doesn't appear here, **extend this catalog before writing the feature** — never inline a primitive into feature code.

> **Status legend.** A row marked **✅ built** exists and its prop shape below reflects the live code. A row marked **🟡 not built** is an aspirational contract from the original spec that no component implements yet — treat it as a design target, not an import. Some primitives live outside `ui/` (in `components/layout/`, `components/chat/`, or `components/tasks/`); the Folder column points at the real location.

---

## Primitive index

| Name | Folder | Status | Purpose |
|---|---|---|---|
| [`ScreenShell`](#screenshell) | `components/layout` | ✅ built | The canonical screen frame every surface composes |
| [`DisplayTitle`](#displaytitle) | `components/layout` | ✅ built | Cormorant serif display page title |
| [`DisplayBody`](#displaybody) | `components/layout` | ✅ built | Sub-title and body text under a DisplayTitle |
| [`OrDivider`](#ordivider) | `components/layout` | ✅ built | Hairline + caption + hairline "or" divider |
| [`WordmarkHeader`](#wordmarkheader) | `components/layout` | ✅ built | Centered wordmark for welcome-style screens |
| [`Button`](#button) | `ui/button` | ✅ built | Every tap target shaped like a button |
| [`Card`](#card) | `ui/card` | ✅ built | Container for grouped content |
| [`GlassSurface`](#glasssurface) | `ui/glass` | ✅ built | Reusable Liquid Glass building block (blur + veil + border) |
| [`TabBar`](#tabbar) | `ui/tab-bar` | ✅ built | The unified floating tab bar with the crimson **cross** center create-action |
| [`GlassSheet`](#glasssheet) | `ui/glass` | ✅ built | iOS-style bottom sheet with Liquid Glass surface |
| [`Toast`](#toast) | `ui/glass` (`GlassToast` + `ToastHost`) + `lib/toast.ts` | ✅ built | Single-source notification surface |
| [`Skeleton`](#skeleton) | `ui/skeleton` | ✅ built | Loading placeholder shaped like the real content |
| [`Input`](#input) | `ui/input` | ✅ built | Single-line text input |
| [`CitationChip`](#citationchip) | `components/chat` | ✅ built | Provenance pill on AI-derived task/voice references |
| [`CircleIconButton` / `HelpButton`](#chrome-buttons) | `ui/icon-button` | ✅ built | Round back/close + dark "?" chrome buttons |
| Also built: `Avatar`, `Dialog`, `Divider`, `Switch`, `Segmented`, `ListRow`, `HeroGradient`, motion (`AsyncBranch`/`Reveal`/`AnimatedRow`) | `ui/*` | ✅ built | See `components/ui/` directly |
| [`TaskRow`](#taskrow) | `components/tasks` | ✅ built (not in `ui/`) | The canonical task row |
| [`TextArea`](#textarea) | `ui/textarea` | 🟡 not built | Multi-line text input (use `Input` multiline for now) |
| [`DomainBadge`](#domainbadge) | `ui/domain-badge` | 🟡 not built | The 6-domain identity pill (domain tinting is inlined today) |
| [`AgentActivity` → `ToolCallCard`](#agentactivity--shipped-as-toolcallcard) | `components/chat` (`ToolCallCard`) | 🟡 partial | Multi-step agent step card — target is the simpler `ToolCallCard` |
| [`BriefingCard`](#briefingcard) | `ui/briefing-card` | 🟡 not built | Briefing renders as date-bucketed sections, not a numbered card |
| [`DocumentTile`](#documenttile) | `ui/document-tile` | 🟡 not built | Documents tab is a stub |
| [`VoiceComposer`](#voicecomposer) | `ui/voice-composer` | 🟡 not built | Voice is a full-screen capture route, not a composer sheet |
| [`DateHeader`](#dateheader) | `ui/date-header` | 🟡 not built | Today hero is composed inline |
| [`GroupHeader`](#groupheader) | `ui/group-header` | 🟡 not built | Group headers are inlined |
| [`EmptyState`](#emptystate) | `ui/empty-state` | 🟡 not built | Empty states are composed inline (Mo + heading + CTA) |

---

## ScreenShell

The canonical three-zone frame every screen composes. Mirrors the auth screens (the design north-star) so every onboarding, tab, and feature surface inherits the same rhythm.

```
<ScreenShell
  header={<ScreenShellHeader />}          // back button or wordmark
  footer={<Button variant="primary" />}    // primary CTA + optional ghost
>
  <DisplayTitle roman="Reset your" italic="password." />
  <DisplayBody>We'll send you a link to pick a new one.</DisplayBody>
  …
</ScreenShell>
```

**Required:**
- `children` — the body content (already wrapped by ScreenShell in `px-8`).

**Optional:**
- `header` — render-prop slot for the top zone (`<ScreenShellHeader />` is the default back-button variant).
- `footer` — render-prop slot for the pinned CTA zone.
- `centerContent` boolean — vertically center the body (welcome / check-email pattern). Default `false`.
- `footerPadding` — `'sm' | 'md' | 'lg'` → `pb-10 | pb-12 | pb-16`. Default `'sm'`.
- `padded` boolean — when `false`, the body fills edge-to-edge (used for scene-host screens like voice-demo). Default `true`.

**Banned:** No styling props (no `bg`, `tint`, `colorScheme`, `className`). If you need something the slots can't express, extend ScreenShell with a *structural* prop — don't leak ad-hoc classes into feature code.

**Visual reference:** auth gold-standard at `app/(auth)/signin.tsx` and `app/(auth)/forgot.tsx`.

---

## DisplayTitle

The canonical app title: **Cormorant Garamond** serif (`font-display`). Renders flat (single string); Cormorant italic is reserved for rare display emphasis, never the default.

```tsx
<DisplayTitle text="What's your email?" size="prompt" />
```

**Props:**
- `text` (string) — **preferred** single-string API.
- `roman` + `italic` (strings) — *legacy* two-part API, kept so old callers work. They are simply **joined and rendered uniformly** (no italic). Prefer `text`.
- `size` — `'md' | 'hero' | 'prompt'` (default `'md'` → `text-display-md` 28px).
- `align` — `'left' | 'center'` (default `'left'`; only date / welcome / wordmark headers center).

**Banned:** Don't accept generic `children`. Don't reach for `<Text className="font-display ...">` in feature code — use this.

---

## DisplayBody

Sub-title body text under a DisplayTitle. Mirrors the `font-sans text-body text-ink-muted` block on every auth screen.

**Required:**
- `children`

**Optional:**
- `tone` — `'muted' | 'subtle' | 'ink'` (default `'muted'`).
- `size` — `'body' | 'body-sm' | 'caption'` (default `'body'`).
- `align` — `'left' | 'center'`.
- `className` — escape hatch only for spacing utilities (`mt-*`). Never colors or type sizes.

---

## OrDivider

The `or` divider: hairline + caption + hairline. Lifted verbatim from `app/(auth)/signin.tsx`.

No props. Use anywhere a stack of choices needs a divided "either-or" rhythm.

---

## WordmarkHeader

The centered brand wordmark — **Cinzel** caps ("LIFE ADMIN / AUTOPILOT", `text-wordmark`) with the crimson **cross** above it. The only intentionally-centered chrome in the app; anchors welcome / hero surfaces.

**Optional:**
- `tagline` (string — e.g. `"I watch over your life admin."`, `text-label` `ink-subtle`).

---

## Button

The single source of truth for every button-shaped tap target.

**Variants:** `primary` (filled **crimson**, white label, `rounded-md` rectangle — never a pill), `secondary` (white + crimson label + hairline border), `ghost` (no chrome), `destructive` (filled `danger`), `link` (text-only).

**Sizes:** `sm` (32px), `md` (44px — default), `lg` (52px — hero actions), `icon` (40×40 square). The center create-action (the cross) is a separate circular control, not a Button variant.

**Required:**
- `children` (text or `<Icon /> + text`)
- `onPress` handler

**Optional:**
- `variant`, `size` (defaults: `primary`, `md`)
- `disabled` boolean
- `loading` boolean — replaces content with three pulsing `LoadingDots`, disables the press
- `leftIcon`, `rightIcon` (rendered nodes — note: **`left`/`right`**, not `leading`/`trailing`)
- `fullWidth` boolean
- `className`, `accessibilityLabel`, `testID`

`onPress` is optional in the type (a disabled/loading button may omit it).

**Banned:** Don't wrap a raw `<button>` to "look like a button", and don't put an `onClick` on a `<div>`. There is one button.

**Accessibility:** `accessibilityRole="button"`, `accessibilityState={{ disabled, busy: loading }}`. Tap target is 44×44 minimum regardless of visual size.

**Visual reference:** `design.md` → component pattern #5 (voice composer send button), pattern #9 (floating tab bar).

---

## Card

Container for grouped content. A rounded (`radius-lg`) white surface with a hairline `border` and a whisper `shadow-card`, lifting gently off the marble canvas. Cards never blur — that's reserved for glass chrome.

**Props (actual):**
- `children`
- `tone` — `'surface'` (white + hairline + shadow, default) | `'sunken'` (`surface-sunken`) | `'accent'` (`accent-soft` wash — selected/overdue).
- `padded` — boolean, default `true` (→ `p-4`). Set `false` for edge-to-edge rows that own their own padding (e.g. a settings group).
- `className` — escape hatch for layout utilities.

> A tappable-card variant isn't built in. If you need one, wrap the `Card` in a `<button>` (or compose the shadcn primitive) rather than putting an `onClick` on a `<div>`.

**Banned:** No nested cards ("card-in-a-card"). If you need a hierarchy inside a card, use whitespace + a divider, not another card.

**Visual reference:** `design.md` → component pattern #3 (task row card).

---

## GlassSurface

The reusable building block for every floating-chrome surface that uses glass. Sheets and toasts compose this primitive. (The tab bar does **not** — `TabBar` is a flat white surface.)

**Required:**
- `children`

**Optional:**
- `intensity` (`'chrome' | 'sheet' | 'toast'`) — maps to a `backdrop-blur` strength token. Default: `'sheet'`.
- `radius` — token name (default `rounded-2xl`). Use `rounded-pill` for pill shapes.
- `className` — merged on top of the default surface classes.

**Behavior (web/Capacitor):**
- CSS `backdrop-blur` (`backdrop-filter`) over a translucent white veil; a hairline `border` is always drawn on top for definition.
- WKWebView (iOS Capacitor) and modern Chromium (Android) both support `backdrop-filter`. Where it's unavailable, it degrades to a solid translucent `surface` fill — the floating shape still carries the design.

**Banned:** Don't apply `backdrop-blur` directly outside this primitive, and never on content surfaces (cards, rows) or full-screen backgrounds — floating chrome only.

**Visual reference:** `design.md` → *Liquid Glass — scoped use only*.

---

## Chrome buttons

The round chrome buttons.

- **`CircleIconButton`** — a round button (white `tone="light"` or graphite `tone="dark"`) with a hairline border + whisper shadow, for back / close affordances. Top-left of hero screens.
- **`HelpButton`** — the "?" button (`CircleIconButton tone="dark"`). Top-right of hero / welcome screens.

Use these for chrome; never a raw `<button>` styled ad-hoc. See `AGENTS.md` → Primitives.

---

## TabBar

The single, unified bottom navigation, rendered once in the app shell. iOS, Android, and Web alike (no platform split). It is **not glass**: a flat white floating surface (`rounded-pill`, hairline `border`, `shadow-card`) so the crimson cross reads as the focal element.

**Composition — five slots, the cross in the center:**
- Four destination tabs — **Dashboard · Matters · Documents · Profile** — `text-micro` label under a lucide outline icon (24px).
- **Center create-action:** a raised **crimson circle bearing the cross** (`assets`/`components/icons` cross SVG, white). Tapping it opens the create/voice flow. This is the system's action mark — distinct from the King symbol.
- Floats above content with a bottom inset + horizontal margin.
- Active indicator slides under the active tab via CSS `translateX` only (no width/height animation), `var(--duration-base)`, disabled under `prefers-reduced-motion`. Active tab: icon + label `accent` (crimson). Inactive: `ink-subtle`.
- Route → icon map (lucide): Dashboard → `LayoutGrid`/`House`, Matters → `ListChecks`, Documents → `FileText`, Profile → `User`. Center → the custom crimson cross.

**Layout contract:** exports a `TAB_BAR_HEIGHT` constant; every route pads its bottom by it so content clears the floating bar.

**Banned:** No emoji or mascot avatar in the bar. Don't add a tab without registering its route + icon. The cross is reserved for the center action — don't reuse it as a generic icon.

**Visual reference:** `design.md` → component pattern #9; `assets/screenshots/home-reference.png`.

---

## GlassSheet

Bottom sheet / drawer with a glass surface. In V2 this is a thin wrapper over the **Radix/`vaul` Drawer** (added via `npx shadcn@latest add drawer`), with `GlassSurface` as the panel background, `rounded-2xl` top corners.

```tsx
<GlassSheet open={open} onOpenChange={setOpen}>
  {children}
</GlassSheet>
```

Controlled `open` / `onOpenChange`. Focus trap, scrim, swipe-to-dismiss, and reduced-motion come from Radix/vaul.

**Banned:** Don't roll a custom modal with a manual backdrop. Use `GlassSheet` (or the Radix `Dialog` for centered modals).

---

## Toast

Single-source notification surface, backed by **`sonner`** (`components/ui/sonner.tsx`, mounted once in `app/providers.tsx`). Everything else uses the imperative API in `lib/toast.ts`. Copy is factual and institutional — no exclamation marks (`Task created. Policy attached.`).

**API (from `lib/toast.ts`):**

```ts
toast.success(title: string, opts?: ToastOptions): toastId
toast.error(title: string, opts?: ToastOptions): toastId
toast.info(title: string, opts?: ToastOptions): toastId
toast.loading(title: string, opts?: Pick<ToastOptions, 'description'>): toastId // no auto-dismiss
toast.dismiss(id: toastId): void

interface ToastOptions { description?: string; action?: { label: string; onPress: () => void } }
```

**Behavior:** auto-dismiss after ~3.2s for success/error/info; `loading` persists until dismissed. Same variant+title dedupes (no spam-stacking); visible stack capped at 3 (oldest dropped). There is **no** `duration` override.

**Banned:** Don't use `window.alert()`/`confirm()` or any other library. `lib/toast.ts` is the only notification surface.

---

## Skeleton

Loading placeholder. Renders a pulse-animated `surface` block sized to match the real content shape.

**Required:**
- `width` and/or `height` (numbers or strings)

**Optional:**
- `radius` (defaults to `radius-md`)
- `circle` boolean (sets `radius-pill`, requires equal width/height)

**Pattern:** Each major component ships its own skeleton (e.g. `TaskRowSkeleton`, `BriefingCardSkeleton`) composed of these primitive shapes. Never use a generic full-screen spinner for page loads.

**Visual reference:** `design.md` → "Loading states" section.

---

## Input

Single-line text input.

**Required:**
- `value` (string)
- `onChange` (handler)

**Optional:**
- `placeholder`
- `leadingIcon`, `trailingIcon`
- `error` (string — when set, renders below in `danger`)
- `label` (string — only render if heading + placeholder don't already communicate)
- `helperText`
- `type` (`text | email | password | …`), `inputMode`, `autoComplete`

**Visual:** `surface-sunken` bg, `radius-sm`, 44px tall, padding 12/16, focus ring in `accent` (crimson).

**Banned:** Don't use a raw `<input>` outside `components/ui/input`. Don't render `<label>` + `<input>` + `<error>` manually — that's what RHF's `<FormField>` is for (a thin wrapper over `Input`).

---

## TextArea

🟡 **Not built as a separate primitive.** Use `Input` with `multiline` for now; a dedicated `ui/textarea` would be the multi-line variant of Input (same props minus `secureTextEntry`).

---

## DomainBadge

🟡 **Not built as a shared primitive** — domain tinting (`domain-{name}` bg + `domain-{name}-ink` text, with `DomainIcon` from `components/icons/`) is currently inlined where needed. Contract below stands as the design target if/when it is extracted.

The pill that surfaces which life domain something belongs to. Used in three places: group headers, icon chips in task rows, and domain selector chips.

**Required:**
- `domain` (`'health' | 'home' | 'car' | 'finance' | 'family' | 'pets'`)

**Optional:**
- `variant` (`'pill'` — the group header style with uppercase label + count / `'chip'` — the inline `DomainIcon` chip)
- `count` (number — shown on the `pill` variant)
- `expanded` boolean (for `pill` chevron direction)
- `onClick` (toggles expansion)

**Visual:** Background from `domain-{name}` stone tint, text/glyph from `domain-{name}-ink`. The `chip` variant shows a `DomainIcon` (a custom crimson/ink glyph) — **never an emoji**.

**Visual reference:** `design.md` → component pattern #2 (domain group pill).

---

## AgentActivity → shipped as `ToolCallCard`

🟡 **The rich multi-step `AgentActivity` was not built.** The V2 target is the simpler **`ToolCallCard`** (`components/chat/ToolCallCard.tsx`) — one card per proposed tool call, below an assistant message, with three states (conditional render / CSS cross-fade — no Moti):

- **`pending_confirmation`** — `accent-soft` (crimson wash) card, factual intent + arg summary (`The system will create a matter…`), Confirm / Decline buttons (both show a loader + lock out while in flight, so a slow network can't double-fire).
- **`executed`** — stated flatly in `ink-muted` with a one-line result summary (no green, no celebration).
- **`failed` / `declined`** — muted card with the error or decline reason.

**Props:**
- `call` (`AiToolCall` from `queries/ai`)
- `onConfirm(callId: string)`, `onDecline(callId: string)`
- `pendingAction?` (`'confirm' | 'decline' | null`)

Tool names it labels: `createTask`, `updateTask`, `completeTask`, `deleteTask`, `deleteAllTasks`, `snoozeTask`, `queryTasks`.

---

## CitationChip

✅ **Built** — but in `components/chat/CitationChip.tsx`, and **scoped to chat task/voice references**, not the general document/web/confidence provenance pill the original spec described.

What it actually does: the assistant streams text containing `[task:<id>]` / `[voice:<id>]` markers; `InlineCitations` splits the text and renders each marker as a tap-able crimson chip (white `surface`, hairline border).

**`CitationChip` props:**
- `kind` (`'task' | 'voice'`)
- `id` (string — the 24-char Mongo id)
- `label?` (string — falls back to "Task" / "Voice note")

Tapping a `task` chip pops back to a tab (so the `CreateTaskSheet` host is mounted) then opens that task's sheet. A `voice` chip is non-interactive. Markers that don't resolve to a known source render as a muted italic "(unverified)".

**`InlineCitations` props:** `text` (string), `sources` (`AiSource[]`).

> The `source: { kind: 'document' | 'web'; uri; page }` + `confidence` API and the "required on every AI-derived value" trust contract remain a **design target** (`principles.md`), not the current chat implementation.

---

## TaskRow

✅ **Built** — but in **`components/tasks/TaskRow.tsx`** (a feature composite), not `ui/`. The single most-used composite in the app; consumed by the briefing and Today lists. Check the live file for its exact props (`task`, `onPress`, `onToggle`).

The original contract below is the design intent:

**Required:**
- `task` (`Task` object — see `lib/api/tasks.ts` for the live type)

**Optional:**
- `onToggle` / `onToggleComplete` (handler — completion animates)
- `onPress` (handler — opens task detail/edit sheet)
- `showDomain` boolean (default: `true`)

**Composition:** Card → `DomainIcon` chip + title (`heading-sm`) + subtitle (`caption`, due time in `accent`) + a resolve control. On resolve the row drops to `ink-muted` and collapses — **stated, not celebrated** (no confetti, no green).

**Visual reference:** `design.md` → component pattern #3.

---

## DateHeader

🟡 **Not built as a primitive** — the Today hero is composed inline. Design target below.

The canonical date hero on the Today screen.

**Required:**
- `date` (Date object)

**Optional:**
- `onPrev`, `onNext` (handlers for the side chevrons)

**Composition:** Day name in `display-hero` Cormorant serif, full date in `body` (Inter, `.tabular`) beneath, centered. 44px chevron tap targets on the sides.

**Visual reference:** `design.md` → component pattern #1.

---

## GroupHeader

🟡 **Not built as a primitive** — section headers are inlined (see `BriefingSections.tsx`, which renders a label + count row directly).

Section header for a group of TaskRows.

**Required:**
- `domain` (one of the 6) **OR** `label` + `count` (for non-domain groups like `DONE` or `OVERDUE`)
- `expanded` boolean
- `onToggleExpand` handler

**Composition:** Wraps DomainBadge in a row with consistent spacing.

---

## EmptyState

🟡 **Not built as a primitive** — empty states are composed inline. Design target below.

Two variants for the two empty-state styles.

**Variants:** `inline` (a restrained hairline-bordered row, factual copy — `No matters due today.`), `illustrated` (full-screen for major empties — the **King** centered with monumental space, a serif line, and one crimson action).

**Required:**
- `variant` (`'inline'` | `'illustrated'`)
- `message` (string)

**Optional:**
- `cta` (`{ label: string; onPress: () => void }`)
- `illustration` (only for `illustrated` — a component reference)

**Visual reference:** `design.md` → component pattern #10.

---

## BriefingCard

🟡 **Not built.** The briefing does **not** render as a numbered greeting card. What ships is `components/tasks/BriefingSections.tsx`: open tasks date-bucketed into **Overdue / Today / This week / Later** sections (each row a `TaskRow`, animated on every shape change). There is no AI ranking and no numbered top-3. The numbered-italic-card contract below remains an unbuilt design target.

**Original target — Required:**
- `greeting` (string — "Good morning, Alex." style)
- `items` (array of `{ id: string; title: string; domain: Domain; whenLabel: string }`)

**Composition (target):**
- Outer: full-bleed `bg-canvas` (no card).
- Greeting: `DisplayTitle size="md"` (Cormorant serif); status line in `body`/`ink-muted`, counts in `accent` (`3 overdue. 5 due today. 2 approaching.`).
- Each item: numeral in `text-display-numeral text-ink-subtle`, title in `text-heading-sm text-ink`.
- No more than 5 items (*quiet by default*).

---

## DocumentTile

🟡 **Not built** — the Documents tab is a stub. Design target below.

A scanned policy / receipt tile on the Documents grid (CRED Glovebox-style).

**Required:**
- `document` (`{ id: string; title: string; domain: Domain; thumbnailUri?: string; addedAt: string }`)

**Optional:**
- `onPress`
- `onLongPress` (multi-select)
- `selected` boolean

**Composition:**
- `bg-surface`, `rounded-lg`, `shadow-card`, 1:1 aspect ratio inside the grid.
- Thumbnail centered with `priority="low"` (above-the-fold tiles override to `"high"`).
- Caption below in `text-caption text-ink-muted`, lowercase, two-line max with ellipsis.
- DomainBadge `chip` overlaid in the bottom-left of the thumbnail.

**Banned:**
- No `.png`/`.jpg` thumbnails — `.webp` or `.avif` only.
- No explicit dimensions missing — every thumbnail has `width`/`height`.

---

## VoiceComposer

🟡 **Not built in V2.** Voice will capture behind one interface (`lib/voice/*`): web **`MediaRecorder`** in the browser/PWA and a **native Capacitor audio-recorder plugin** for background capture (see `stack.md` / `PLATFORM-DECISION.md`). Transcription is server-side Gemini. Model the recorder as an explicit state machine (idle → preparing → recording → stopping) — see `LESSONS.md` #4.

**Original target — Required:** `open`, `onClose`, `onTranscript`.

**Composition (target):**
- Built on `GlassSheet`, single snap at content height.
- Top: a `display-prompt` line (Cormorant — `Speak.`).
- Middle: a calm crimson level meter (CSS `transform` only, no bouncing spectacle), disabled under `prefers-reduced-motion`.
- The record affordance is a restrained **crimson** control — never a mascot, never an emoji.

---

## How to apply

When building a new feature:

1. **List the UI atoms you need.** Each one should map to a primitive above.
2. **If something doesn't map,** extend this catalog *before* writing the feature. Don't inline a one-off button or card into a feature folder.
3. **Composition is fine; reinvention is not.** A "task row with a special icon" composes `TaskRow` + a custom prop, not a new component.
4. **The primitives folder is the public API of the design system.** Treat it like a library boundary — when you change a primitive, every feature folder is a consumer.

Related: [`design.md`](design.md), [`aesthetic.md`](aesthetic.md), [`tokens.md`](tokens.md), [`../AGENTS.md`](../AGENTS.md).
