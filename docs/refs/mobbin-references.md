# Life Admin Autopilot — Mobbin References

> **⚠️ Superseded by the rebrand.** These Mobbin references (Tiimo / Manus / CRED —
> the warm "flat-serif spine + emoji rows + indigo" system) belong to the **retired**
> aesthetic. The current visual direction is the **white-marble + crimson silent
> sovereign** — its references are [`../new-direction.md`](../new-direction.md),
> [`../aesthetic.md`](../aesthetic.md), and `assets/brand/king.png` +
> `assets/screenshots/home-reference.png`. Kept only as historical context; do **not**
> build against these.

## Lead references (the visual spine of the product)

The design system inherits from three iOS apps, each owning a specific surface family.

| Role | App | Why |
|---|---|---|
| **Spine** | **Tiimo** | Italic-serif date header + group pills + emoji-iconified task rows. Calm, intentional, premium. Light + dark parity proven. |
| **AI surfaces** | **Manus** | Minimal off-white + italic-serif prompt + step-by-step agent activity with tool-call pills. Premium AI-agent aesthetic. |
| **Document vault** | **CRED Glovebox** | Dark italic-serif wordmark + uppercase tracked section labels + illustrated document tiles. Document-storage aesthetic. |

---

## 🟢 Tiimo — visual spine

> The canonical screen for our entire visual language is the **Today view** below.

### Today screen (light mode)

- **[Canonical: Thursday with Anytime group](https://mobbin.com/screens/39db7491-b25a-400e-9e46-d15901520672)** — THE reference. Big italic-serif "Thursday" + flat task list. This is the single source of truth for our typography rhythm and surface stack.
- [Thursday with Morning/Afternoon time-bucket groups expanded](https://mobbin.com/screens/3d9ddcea-4afd-4da7-9a97-eafa774cc7af) — group pill pattern. We re-purpose these for our 6 domain pills.
- [Thursday with Done section + struck-through completed task](https://mobbin.com/screens/35186446-384e-4887-a73e-03e8bc79b58d) — completion treatment.
- [Bottom of Today + Planned timeline](https://mobbin.com/screens/4054c64e-f464-4582-a3e1-c4612a62daf3) — "Time left of day" affordance.
- [Thursday with collapsed groups](https://mobbin.com/screens/afc89c0c-ca6b-4739-b2cc-24cb31e9971c) — collapse/expand state.
- [Thursday with all groups expanded](https://mobbin.com/screens/d990d02c-e750-43b7-a814-d46ac783592d)

### Dark mode (proves the system works in both themes)

- [Tuesday dark mode](https://mobbin.com/screens/8a6a1881-0e17-4cfa-9aa4-114d0b90aeec) — same serif system, pure-black canvas.
- [Tuesday dark, collapsed sections](https://mobbin.com/screens/9a43550f-01cc-49bc-9195-1e0a481a6e71)

### Priority / domain groups (variant of the same pattern)

- [To-do with HIGH / MEDIUM / LOW priority pills + confetti animation](https://mobbin.com/screens/c205c388-cfcd-404d-af31-37a6418911bc) — completion celebration.
- [To-do priority list](https://mobbin.com/screens/3e375981-1424-44c7-b22c-a5c84943e2ed)

### AI task creation (chat → linked tasks fan-out)

- [Reading books task created from chat](https://mobbin.com/screens/45a7dc11-a595-41d0-8069-dc06f3326e5a) — single-task creation pattern.
- **[Evening wind down generated as multi-step routine](https://mobbin.com/screens/995c52a8-9632-42e1-b45e-f8d951e95d17)** — one prompt → linked tasks. This is *exactly* the voice-agent fan-out we need for the hero feature.

### Briefing / plan pattern

- [Plan tab with "Review today" + daisy illustration](https://mobbin.com/screens/65919926-4b17-49ba-aeb5-f0023cc0447d) — template for the Proactive Daily Briefing card with custom illustration.

---

## 🔵 Manus — AI agent surfaces

> Every AI-active surface in Life Admin inherits from Manus pixel-perfect.

### Voice / prompt entry

- **[Italic-serif "What can I do for you?" prompt](https://mobbin.com/screens/b38138bc-8f63-4b92-aa9f-ae9232830830)** — THE voice-agent entry aesthetic. Big italic serif heading + bottom waveform pill input.

### Agent activity log (the gold standard)

- [Wide Research progress 35/50 with checkmark sub-tasks](https://mobbin.com/screens/9083384c-a700-4359-8fbc-879e29c66f68) — enumerated sub-task progress.
- [Wide Research 0/50 starting state](https://mobbin.com/screens/8a153d98-64f5-4d63-a0c4-e079dd7511d5)
- [Wide Research 14/50 + "Manus will continue after your reply" wait state](https://mobbin.com/screens/5d0f4b76-a8c3-44d5-9ef1-026be6656cbe) — explicit AI-pause-for-input pattern.
- [Wide Research 19/50 with "Skip incomplete ones" override](https://mobbin.com/screens/08137b86-5f12-4e1e-a4dd-e11ca8683190) — user override during long-running task.
- **[Researching orchids with Searching / Browsing / Reading file pills](https://mobbin.com/screens/1fcf114e-d809-4e1c-94c8-4cefb5520a37)** — the tool-call pill pattern, copy pixel-perfect.

### Tool-call execution display

- [Skip incomplete + Executing command pills](https://mobbin.com/screens/1aa6ea9b-8f16-49e5-91a6-cc20794ddff2)
- [Slides creation with collapsible steps](https://mobbin.com/screens/61020e0d-0c5b-4cc4-a5f4-5a2f33198a43)
- [Slides outline with numbered sections](https://mobbin.com/screens/420d6f5d-b7e4-4e75-bda9-569417434dc5)
- [Website generation with file tool calls](https://mobbin.com/screens/470227ce-9b5d-4f5c-a14d-b6ba0ea434d5)

### Automation / scheduled-task list

- [Scheduled tasks bottom sheet with iOS toggle switches](https://mobbin.com/screens/57c27a24-48f1-4e67-ad31-6d4f68e0e351) — direct template for the Natural Language Automations feature.

---

## 🟣 CRED Glovebox — document vault

- **[Glovebox vehicle + personal documents view](https://mobbin.com/screens/860f9549-b074-4bbd-af45-8e3153fd6cf3)** — THE document vault aesthetic. Italic-lowercase wordmark, uppercase tracked section labels ("YOUR VEHICLE DOCUMENTS"), illustrated document tiles in 3-col grid, green % complete bar.

---

## Supporting references (by surface)

### Document scan / OCR (real-time field extraction)

- **[Brex scan receipt with extracted merchant + amount overlay](https://mobbin.com/screens/590f0b25-00c8-47b4-8a81-51bcdf73d3e1)** — pixel-perfect copy for Document-to-Task scan.
- [Evernote scanning a document with "Looking..." overlay](https://mobbin.com/screens/6040e4b7-9eae-4b5f-a661-f84816b463bb)
- [Craft scan with thumbnail history](https://mobbin.com/screens/5a62a277-c315-44ea-8d02-68fe194c53bd)
- [DocuSign "AI-Assisted" pill + Identifying key terms processing](https://mobbin.com/screens/2bb65a1e-1661-45ba-b6ca-2268d0d98d78)
- [Onfido cut-off image detected error state](https://mobbin.com/screens/ddfbaa99-aa9c-41e1-aa8a-cff06c6f1640) — error handling during scan.

### Citations / source provenance

- **[Perplexity Copilot activity log + source cards](https://mobbin.com/screens/a494bfc9-f0cd-4776-bf0f-3aeb1022af9c)** — pixel-perfect copy for the CitationChip primitive + source card list.

### Insurance / domain dashboards (warm trust)

- [Alan hero action cards grid + animated mascot](https://mobbin.com/screens/fe47ee98-cd4d-43a4-95da-4fbab8db8c7d) — warm coral-cream gradient.
- [State Farm "Good evening" + upcoming bills + voice mic in top-right](https://mobbin.com/screens/d90846f2-9dc4-4b12-b6c9-9745b4946da7) — voice-in-dashboard pattern.
- [State Farm insurance card view + Add to Apple Wallet](https://mobbin.com/screens/bd8648f9-4aff-49bf-93b1-da9ec23d558c) — branded card chrome + Wallet integration.
- [State Farm Insurance section](https://mobbin.com/screens/ebb84862-ac81-40ff-b25e-03fe67c98a18) — More actions card pattern.
- [Lemonade Pet policies with illustrated header](https://mobbin.com/screens/101de30b-8fbf-441e-aff4-9ed8b5d398ec) — illustrated domain header.
- [Lemonade pet claims + policies](https://mobbin.com/screens/bc88c92e-04cd-41b3-a0f5-dd873dde320b)

### Daily briefing (calm digest)

- [Stoic "good afternoon" + journal cards](https://mobbin.com/screens/37363157-e456-487f-9346-cc927c79a52a) — calm greeting.
- [SCMP "My Daily 5" numbered briefing](https://mobbin.com/screens/90cc2499-4bc3-493f-a42b-705057c4cbf9) — numbered top-N pattern.
- [Medium Today's highlights serif digest](https://mobbin.com/screens/30babb96-ee71-4fa0-9368-40daa176a2ec)
- [Withings "Good morning, John" + Today's Missions](https://mobbin.com/screens/b5edc357-52d7-4d2c-9340-d151b7edf4fd) — mission cards integrated with greeting.

### AI thinking surface (transparent reasoning)

- [DeepSeek "Thought for 5 seconds" + collapsed reasoning](https://mobbin.com/screens/75233c29-f56c-4af8-b200-c0549a2827ca) — reasoning expansion pattern.
- [DeepSeek thinking surface, full view](https://mobbin.com/screens/ced078a7-d72c-4208-b954-0ad17b3576fb)

### Voice input (waveform / mic permission)

- [Manus voice waveform input pill](https://mobbin.com/screens/b38138bc-8f63-4b92-aa9f-ae9232830830) — see bottom pill on the same canonical Manus screen.
- [Hinge "Add a Voice Prompt" + native iOS permission alert](https://mobbin.com/screens/0dba149b-8899-4ce1-9663-705844bee287) — serif title + native permission.
- [Spotify DJ mic permission + animated mascot](https://mobbin.com/screens/0831a00e-8379-44a1-8992-f3e79dcd3cdb) — rich permission explanation.
- [Tolan 3D crystalline form (atmospheric variant — not selected, kept for contrast)](https://mobbin.com/screens/2342342c-efd3-417b-ac6e-0cf7c2c9bbc1)
- [Meta AI gradient orb (premium-blob variant — not selected, kept for contrast)](https://mobbin.com/screens/a13d716b-b9dc-4775-9934-b5c881b221a3)

### Related task apps (contrast / alternative patterns)

- [Todoist Today list](https://mobbin.com/screens/cf025188-3f12-4440-828c-5225688c81dd)
- [Todoist Ramble with extracted metadata pills (Tomorrow, P1, Finance)](https://mobbin.com/screens/a0eb481c-fba0-45c9-bdd0-b413c7c9f285) — alternative task metadata pattern.
- [Superlist Today minimal](https://mobbin.com/screens/3e9c7d4b-c7cc-4251-bbb3-4aea6b29d40d)
- [Clover Today + searched tasks](https://mobbin.com/screens/7b420647-857c-4bd1-a952-131e43dd6707)

---

---

## 🟡 Modern chrome — Liquid Glass tab bar + sheets

> Added 2026-05-18 when refactoring the bottom bar from the stock Expo default to a floating Liquid Glass pill. These refs are the *visual chrome* (tab bar, sheets, toasts). They are **not** allowed to override the Tiimo flat-serif spine for content surfaces — they only inform the chrome layer.

### Floating pill tab bar (the immediate visual win)

- **[Tiimo dark — Tuesday with raised active-chip tab bar](https://mobbin.com/screens/8a6a1881-0e17-4cfa-9aa4-114d0b90aeec)** — our visual base. The active tab sits inside a raised pill chip; the icon stays the same shape.
- **[Apple Photos pill segmented tab bar + floating search circle (iOS 26 Liquid Glass)](https://mobbin.com/screens/27f28cbe-b863-496e-9e8b-a2947866f057)** — canonical iOS 26 Liquid Glass: two pill clusters floating independently over content.
- [Apple Photos modal over Library — frosted glass at full intensity](https://mobbin.com/screens/e7215100-cdc1-4799-9b86-f88dffba4441) — shows the maximum glass treatment on a sheet.
- **[Apple TV Liquid Glass tab bar over photographic content](https://mobbin.com/screens/91bdd973-4641-4170-8620-bcc146551edc)** — proves glass tab bars work over varied backgrounds.
- [Calm pill tab bar over gradient](https://mobbin.com/screens/9207c8ed-8260-42df-b162-47b899ae6bc2) — soft-purple chip background variant for a gentler accent.
- [Apple Fitness pill tab bar with chip active state](https://mobbin.com/screens/021d6e62-8a5b-4974-9dcf-4474275a7f49) — alternative chip styling, chips around inactive tabs too.
- [Linear Mobile clean floating pill bar](https://mobbin.com/screens/84952603-1bcb-4331-8a45-2a5f5ed68706) — minimal monochrome variant.
- [Play minimal pill tab bar with single chip active](https://mobbin.com/screens/5a796023-ef12-4dc2-bf87-59a9c3c6daf9) — three-tab variant.
- [Revolut Business dark glass tab bar](https://mobbin.com/screens/c119559f-95c2-49ed-acad-5f2ee953c1e6) — dark mode glass with overlaid context menu.

### Glass sheets / modals over backdrop

- [TIDE settings sheet frosted glass over photographic background](https://mobbin.com/screens/3779b437-b4c2-4c1e-9ae4-a8bccc643a79) — the sheet treatment to copy for voice composer and document detail sheets.
- [Revolut Business dark glass settings list](https://mobbin.com/screens/306687c3-03e3-4ed3-9ab7-fc9c179b4705) — stacked glass cards on dark canvas.
- [Moonlitt soft glass card on indigo gradient](https://mobbin.com/screens/11c775fd-2131-4fa1-86e2-21fca7e45062) — tinted glass card pattern.

---

## Browsing protocol

When a teammate joins the project or design drift is suspected:

1. Open the **canonical Tiimo Thursday screen** in one window.
2. Open the local build (simulator / web) in the other.
3. Compare typography rhythm, surface depth, spacing, and group-pill treatment.
4. If they diverge, fix the local build to match the reference — *not* the other way around.

When designing a new screen that has no reference here:

1. Identify which **lead ref** owns that surface family (spine / AI / vault).
2. Find the closest existing screen in that ref's section.
3. If nothing fits, search Mobbin for the missing surface and add the new reference to this doc *before* writing the component.

## Updating this doc

- Adding new references: append to the appropriate section with a 1-line description and a direct Mobbin URL.
- Removing references: only remove if the reference is wrong or the screen was deleted from Mobbin. Otherwise prefer to mark deprecated and note why.
- Never edit URLs without verifying they still resolve.
