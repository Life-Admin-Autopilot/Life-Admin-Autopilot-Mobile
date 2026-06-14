# Life Admin Autopilot — Features Catalog

Every feature from the pitch, classified `v1` or `phase 2`, with its primary surface, design reference, and the key risk it carries.

---

## v1 hero loop — 4 features

These four close the loop end-to-end: *speak → tasks created → filed by domain → surfaced in tomorrow's briefing.* All four must ship together.

### 1. Voice-First AI Agent · `v1` · hero

**What it does:** User taps mic, speaks one sentence (`renew my car insurance before the 15th and compare 3 quotes first`), and the agent produces multiple linked tasks with smart reminders and citations to source documents.

**Primary surface:** Voice composer (bottom sheet, Manus-style) → agent-activity card (Manus-style with tool-call pills) → resulting task list (Tiimo-style task rows).

**Design reference:**
- Composer: [Manus prompt "What can I do for you?"](https://mobbin.com/screens/b38138bc-8f63-4b92-aa9f-ae9232830830)
- Agent activity: [Manus tool-call pills (Searching / Reading)](https://mobbin.com/screens/1fcf114e-d809-4e1c-94c8-4cefb5520a37)
- Fan-out result: [Tiimo evening wind down multi-step routine](https://mobbin.com/screens/995c52a8-9632-42e1-b45e-f8d951e95d17)

**Key risk:** Voice transcription accuracy in noisy environments, mixed-language input (English + Arabic), and ambiguous date parsing ("the 15th" — which month?). Mitigations: explicit confirmation UI before tasks are written, CitationChip on every extracted value, low-confidence values rendered as `warning` and the agent asks instead of guesses.

**Acceptance:** A user can speak one sentence and end up with the right linked tasks, with each task showing its source citation, within ~5 seconds of finishing speaking.

---

### 2. AI Workspace Assignment · `v1`

**What it does:** Every matter created (by voice, doc-scan, or manual entry) is automatically filed into one of six life domains: Health, Home, Car, Finance, Family, Pets.

**Primary surface:** Matter rows in the dashboard group by domain (uppercase domain label + count). Domain assignment is shown via the `DomainIcon` chip (a stone-tint + crimson/ink glyph — **no emoji**) on the matter row and editable on tap.

**Design reference:**
- Group pills: [Tiimo Morning/Afternoon time-bucket groups](https://mobbin.com/screens/3d9ddcea-4afd-4da7-9a97-eafa774cc7af) — re-purposed for domain groups.
- Task row: [Tiimo Thursday canonical](https://mobbin.com/screens/39db7491-b25a-400e-9e46-d15901520672)

**Key risk:** Misassignment (a finance task labeled as Home). Mitigations: show the domain choice during the voice-agent confirmation, allow one-tap reassignment, and learn from corrections (logged for the future ML pipeline; no on-device learning in v1).

**Acceptance:** 90%+ of tasks land in the correct domain on first creation, with a one-tap correction affordance for the remainder.

---

### 3. Document-to-Task Chain · `v1`

**What it does:** User scans a document (insurance policy, registration, bill, warranty card). The system extracts key fields (dates, amounts, policy number, parties) and creates linked tasks (`Renew before [date]`, `Pay $[amount] by [date]`). Each extracted value is shown with a CitationChip back to the source PDF page.

**Primary surface:** Camera capture (Brex-style real-time extraction overlay) → review screen (extracted fields with confidence indicators) → task list (Manus-style step-by-step) → archived document in the vault (CRED Glovebox-style tile).

**Design reference:**
- Scan: [Brex receipt with extracted overlay](https://mobbin.com/screens/590f0b25-00c8-47b4-8a81-51bcdf73d3e1)
- Vault: [CRED Glovebox documents grid](https://mobbin.com/screens/860f9549-b074-4bbd-af45-8e3153fd6cf3)
- Citation: [Perplexity Copilot source cards](https://mobbin.com/screens/a494bfc9-f0cd-4776-bf0f-3aeb1022af9c)

**Key risk:** OCR errors on poor-quality scans (this is the literal pitch risk — `1/12` parsed as Jan 12 vs Dec 1). Mitigations: every value renders with CitationChip + confidence indicator; low-confidence values are rendered as `warning` and require user confirmation before becoming tasks; the user can tap any value to see the original document with the cited region highlighted.

**Acceptance:** A user can scan a typical insurance renewal letter and end up with correct date, amount, and policy-number tasks, with each task showing its source page.

---

### 4. Daily Briefing · `v1` (partial — AI digest NOT built)

**What ships today:** the Briefing tab (`app/(tabs)/briefing.tsx` + `components/tasks/BriefingSections.tsx`) is a **clear daily view of your open tasks, date-bucketed into Overdue / Today / This week / Later**, sorted by due date within each bucket. Loading, empty, and error states are all handled; rows animate on every change. It is a straightforward, fast read of what needs handling.

**🟡 NOT built yet — the "proactive AI digest":**
- **No AI ranking.** Bucketing is a plain date filter on open tasks — there is no model picking a top-3 or scoring importance.
- **No pre-generation / 05:00 scheduler.** Nothing on the backend generates or caches a briefing each morning; the screen renders live from the tasks query on open.
- **No numbered greeting card.** The promised "Good morning, Mina — top 3" italic card does not exist; it's a sectioned list.

Building the scheduler + ranking is deferred. The empty-state and hero copy have been brought in line with what actually ships (a daily view, not an auto-generated digest).

**Design reference (for the future AI digest):**
- Greeting + plan: [Tiimo Plan tab](https://mobbin.com/screens/65919926-4b17-49ba-aeb5-f0023cc0447d)
- Numbered top-3: [SCMP "My Daily 5"](https://mobbin.com/screens/90cc2499-4bc3-493f-a42b-705057c4cbf9)

**Acceptance (current):** Opening the Briefing tab shows your open tasks grouped by due window, with loading/empty/error states, fast.

---

## Shipped beyond the original v1 four

### 5. AI Copilot Chat · `shipped`

**What it does:** A conversational AI agent (`app/chat.tsx`, backed by `server/src/modules/ai/*`) — the text counterpart to the voice agent, reachable from the crimson cross create-action in the tab bar. The model can propose tool calls (`createTask`, `updateTask`, `completeTask`, `deleteTask`, `deleteAllTasks`, `snoozeTask`, `queryTasks`); **state-changing calls require explicit user confirmation** in the UI (`ToolCallCard`). Assistant replies carry tap-able citation chips back to referenced tasks/voice notes (`CitationChip` / `InlineCitations`). It also supports a synchronous voice mode (record → Gemini transcribe → ask).

**Status note:** originally scoped as phase-2 "after the voice agent." It shipped — chat reuses the same backend agent and tool runner.

---

## Phase 2 — 4 features (deferred)

These are not built in v1. Don't build them early.

### 6. AI Notification Timing · `phase 2`

**What it would do:** AI picks the optimal reminder time for each task based on the task type, the user's response history, and the deadline urgency.

**Why deferred:** v1 ships with static reminder timing (24h before due, then 1h before). The ML loop that tunes timing per user needs usage data that doesn't exist until v1 is in users' hands.

### 7. Task Conflict Detection · `phase 2`

**What it would do:** Spot overlapping or contradicting tasks ("Pay car insurance Mar 15" + "Pay car insurance Mar 12 — DIFFERENT POLICY"). Surface a yellow warning before both fire.

**Why deferred:** Needs a graph view of related tasks that doesn't exist in v1. Build the graph when the data shape stabilizes.

### 8. Natural Language Automations · `phase 2`

**What it would do:** User says ("every month, set aside $200 for car maintenance") and the agent creates a recurring scheduled task. UI matches Manus's scheduled-tasks bottom sheet.

**Why deferred:** Recurrence + natural-language schedule parsing is a meaningful surface to build well. v1 covers one-off tasks plus simple `repeat: monthly` toggles.

**Design reference (for phase 2 when built):** [Manus scheduled tasks bottom sheet](https://mobbin.com/screens/57c27a24-48f1-4e67-ad31-6d4f68e0e351).

### 9. Google Calendar two-way sync · `phase 2`

**What it would do:** Bi-directional sync between Life Admin tasks (with due dates) and the user's Google Calendar.

**Why deferred:** OAuth + sync conflict resolution + handling Google Calendar's API quirks is its own project. v1 ships with a one-way export ("Add to Calendar" button on a task) using the native iOS/Android calendar APIs — no Google integration.

---

## How to apply

When a new feature, request, or scope-change proposal arrives:

1. **Match it to the catalog.** If it maps to an existing v1 entry, refine that entry. If it maps to a phase-2 entry, push back on doing it now.
2. **If it's not in the catalog at all,** apply the [single product test](principles.md) and the [trust contract](principles.md). If it passes, add it as a candidate phase-2 entry — don't quietly absorb it into v1.
3. **Never silently expand v1.** New work goes through this catalog so the team always knows what "v1 done" looks like.

Related: [`overview.md`](overview.md), [`principles.md`](principles.md), [`design.md`](design.md), [`refs/mobbin-references.md`](refs/mobbin-references.md).
