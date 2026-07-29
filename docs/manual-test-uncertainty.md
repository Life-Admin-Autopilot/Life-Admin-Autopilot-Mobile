# Manual test plan — uncertainty holds & the confirmation gate

Two separate mechanisms, often confused. Test them separately.

| | Uncertainty (`holdForClarification`) | Confirmation gate |
|---|---|---|
| Trigger | Fuzzy date / unnameable item / high-stakes undated | `deleteAllTasks` only |
| UI | Inline card in chat + dashboard strip + `/uncertainties` | Inline Confirm/Decline card in chat |
| Modal? | **No modal anywhere** | **No modal in chat.** Only the Matters screen bulk delete uses a real Sheet |
| Blocks the write? | No — task is created immediately | Yes — nothing runs until Confirm |
| Notification? | **No** (default high-cost) | No |

---

## 0. Setup

```bash
# terminal 1 — API (needs Mongo + GEMINI_API_KEY in server/.env)
cd server && npm run dev

# terminal 2 — web
npm run dev            # NEXT_PUBLIC_API_URL=http://localhost:4000 in .env.local
```

Browser is enough for everything **except OS notifications** — see §4.

---

## 1. Uncertainty — the inline chat card

### 1a. Conflicting dates (`kind: 'date'`)

**Prompt:** `i should see the doctor on the 17th or the 19th, im not sure`

**Expect:**
1. One short lead-in line from Kitto — *"Just one I need you on."* It must **not** re-type the question or list the dates in prose.
2. A ledger row: `✓ Held · See the doctor`
3. A **ClarificationDeck card inline in the chat**, directly under the message:
   - domain icon + provisional title
   - the question ("Is it the 17th or the 19th?")
   - tappable chips `The 17th` / `The 19th` (most-likely first)
   - a type-your-own field
4. **Matters already contains the task**, dated with the first option (the guess), as a passive **list** item.

**Verify in Mongo:**
```js
db.clarifications.find().sort({createdAt:-1}).limit(1)  // status 'open', costOfWrong 'high', kind 'date'
db.tasks.find().sort({createdAt:-1}).limit(1)           // kind: 'list', reminders: []  ← empty by design
```

### 1b. High-stakes, no date

**Prompt:** `renew the car registration — next friday or the friday after, cant remember which`

Same shape. The question must be **deadline-defining** ("When is it due?"), not "when should I remind you".

### 1c. Unnameable (`kind: 'detail'`)

**Prompt:** `email that guy about the thing — he knows`

**Expect:** options array is **empty**; card opens straight into the text field (no chips).

### 1d. Mixed turn — the important one

**Prompt:** `pay the rent on the first, and renew my gym membership — i think july? or maybe august, not sure`

**Expect:** rent is **created immediately** (finance, reminder, dated) *and* the gym item is **held** — both in the same turn. Two ledger rows. Failure mode to watch for: the model narrating "first I'll add rent, then…" and only emitting one call.

### 1e. Anti-overask — must NOT hold

**Prompts:**
- `add buy bread, no rush` → one `createTask`, domain `home`, kind `list`, **no card**
- `add a task to wash the car this weekend sometime` → one `createTask`, domain `car`, dated, **no card**

A card appearing here is a **bug** (over-asking).

### 1f. Multiple holds in one turn

**Prompt:** `book the dentist sometime, renew my passport — not sure when it expires, and email that guy about the thing`

**Expect:** **one** consolidated deck with a `1 of N` counter + Back/Next, not N stacked cards. Answering all N submits **one** combined reply.

---

## 2. Uncertainty — the other two surfaces

### 2a. Dashboard

Go to `/dashboard` with ≥1 open clarification.

**Expect** under **Needs you**:
- 💭 chip, **"A guess to confirm"** (singular) / **"A few guesses to confirm"** (plural)
- body: *"I filed them already — correct me if I got one wrong."*
- **No number.** A count here is a deliberate design violation — if you see "3 questions", that's a regression.

**Timing** — all counts come from `GET /me/tasks/counts` (pure aggregation), never from
`/me/digest` (which writes its headline with a model). The strip must appear in the same frame
as the matters list, not after it. While loading it shows one pulsing placeholder row, so the
page must not jump when the real rows arrive. If "Needs you" still lags the list, the dashboard
has been re-pointed at the digest — see `app/dashboard/page.tsx`.

**Live update** — raise a hold in chat *without closing the island*: the strip appears on the
dashboard behind it while the reply is still streaming. Answer one on `/uncertainties`: the row
shrinks on tap, not on the round trip.

### 2b. `/uncertainties` card stack

Tap the strip row.

**Expect per card:** accent pill **"Filed with a guess"**, `1/3` counter, provisional title, the question, chips (or text field for `detail`), and `Type your own` / `Skip` / `Drop`. The surface **morphs height** between cards.

| Action | Endpoint | Result |
|---|---|---|
| Pick a chip | `POST /me/clarifications/:id/resolve` `{type:'option'}` | Deterministic, no AI call |
| Type your own | same, `{type:'custom'}` | **One Gemini call** — fails with 503 if AI unconfigured |
| Skip | `POST .../defer` | Hidden for **7 days** — reload, it must not reappear |
| Drop | `POST .../drop` | Gone permanently; the task survives |

Answer the last one → gradient **"All clear."** celebration + "Back to dashboard".

**Critical check after resolving with a date:** re-read the task. `kind` must have flipped `list` → `reminder` and `reminders[]` must now be populated. That flip is the entire payoff of the feature.

### 2c. Never-answered

Leave a clarification open. After **7 days** the worker sets it `dropped` with answer *"Settled on the original guess."* — silently, **no nudge notification**. To test now, backdate `createdAt` by 8 days and wait one 30s tick.

---

## 3. The confirmation gate

### 3a. Chat — bulk wipe (the only confirmed tool)

**Prompt:** `delete all my tasks`

**Expect:** an **inline card** (not a modal) in the chat stream:
```
▌ Clear matters
  12 matters
  This cannot be undone.
  [ Decline ]  [ Confirm ]
```
- **Decline** → row becomes a muted `✗ Declined`. Nothing deleted.
- **Confirm** → button reads "Confirming…", tool runs, stream **re-enters the agent loop** to finish any remaining steps from the original message.
- Delete is a **soft** delete with an `undoToken` — the copy says "cannot be undone" but the data is recoverable.

**Scoped variant:** `clear all my finance tasks` → same card, label `3 finance matters`.

**Negative test:** `delete the gym task` → runs **inline, no confirmation**. Only the bulk wipe pauses.

**Edge cases:**
- Wait **>1 hour** then Confirm → `pending_call_not_found` ("This confirmation has expired.")
- Double-tap Confirm → second call rejected; the wipe cannot replay.

### 3b. Matters screen — the real modal

`/matters` → select rows → Delete. This is the only genuine modal (bottom Sheet): absolute date range, exact count, expandable list, and ripple warnings for scanned-document matters and already-fired reminders.

---

## 4. Notifications — read this before testing

### You will never see an OS notification in a browser

`syncReminders()` returns `null` immediately when `!Capacitor.isNativePlatform()`. Browser testing gets you the **in-app bell only**.

### A held high-stakes item fires nothing — by design

Default `costOfWrong` is `'high'` → the task is created `kind: 'list'` → `setRulesReminders` is never called → `reminders: []`. Nothing to fire. The rule is *never fire a date we invented*. **Silence here is a pass, not a bug.**

Notifications appear only when:

| Path | Fires? |
|---|---|
| Hold, `costOfWrong: 'high'` (default) | **No** — until you answer |
| Hold, `costOfWrong: 'low'` + a date guess | Yes — created as `reminder` |
| Plain `createTask` with a date | Yes |
| After resolving a hold with a date | Yes — task flips to `reminder` |

No notification is ever written *about* a pending question. The old "N matters need your input" nudge was removed on purpose.

### 4a. In-app bell (browser, fast)

1. `add pay the electric bill tomorrow at <now + 2 minutes>` — a **near** due date so the 5-day lead nudge lands in the past and only the at-due entry is scheduled.
2. Wait ≤30s (worker poll).
3. Bell badge increments within ≤60s (query poll). Panel shows title + `Due <Mon D>.`
4. Opening the panel marks read; badge clears.

Lead-time reference (`leadTime.ts`, keyword beats domain): passport 180d · license 60d · registration 45d · insurance 30d · subscription/renew 21d · tax 14d · **bill/rent/payment 5d** · **appointment/doctor/dentist/call 1d**.

### 4b. OS notification (iOS build required)

```bash
npm run ios:dev
```
1. Grant the notification permission prompt (a `denied` is terminal — reinstall or change it in Settings).
2. Create a reminder due **~2 minutes out**.
3. **Background the app** — scheduling only happens while running; delivery happens with it closed.
4. Notification fires with body `Coming up.` (lead) or `Due now.` (at-due).
5. Tapping it deep-links to the task via the `taskId` in `extra`.

Constraints: window is **30 days**, cap **60** reminders, re-synced wholesale on launch/resume.

---

## 5. Pass/fail summary

- [ ] Fuzzy prompt → inline chat card, **no modal**
- [ ] Task exists in Matters **immediately**, before any answer
- [ ] Held high-cost task is `kind: 'list'` with `reminders: []`
- [ ] Kitto does **not** re-type the question or options as prose
- [ ] Casual prompts (`buy bread`) produce **no** card
- [ ] Mixed turn creates the clear item *and* holds the fuzzy one, same turn
- [ ] Dashboard strip shows **no count**
- [ ] Skip survives a reload (7-day defer)
- [ ] Resolving with a date flips `list` → `reminder` and populates `reminders[]`
- [ ] `delete all my tasks` → inline Confirm/Decline; single delete does not
- [ ] Expired (>1h) confirmation is rejected
- [ ] **No notification** for a held high-cost item
- [ ] Notification fires after the hold is resolved with a date

---

## 6. Regression harness

```bash
cd server && npm run nl-eval
```
Covers `CLARIFY_UNSURE_DATE`, `CLARIFY_MISSING_TIME`, `CLARIFY_ANTI_OVERASK`, `CLARIFY_MIX` plus held-out cases that detect prompt overfitting. Run this before shipping any change to `voice/toolRules.ts`.
