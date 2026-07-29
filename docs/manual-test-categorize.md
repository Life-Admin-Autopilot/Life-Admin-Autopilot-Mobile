# Manual test plan — AI categorize

Kitto re-judges which **area** a matter belongs to and suggests **tags**, then shows
every before→after so the user approves row by row.

The distinction that drives the whole design:

| | Estimate backfill (`estimateBacklog`) | Categorize |
|---|---|---|
| Fills | A blank (`estimate` is optional and often absent) | Nothing — `domain` is **required**, so it always overwrites |
| Writes | Straight through | Never on propose; only what the user ticks |
| Record | None | `TaskBulkOp` `kind: 'categorize'` |
| Undo | No | Yes — shared `POST /me/tasks/undo/:token` |
| Open at once | n/a | **One per user**, enforced by a unique partial index |

Because it is always corrective, nothing is applied without review. That is what the
`proposed` status and per-entry `confidence` on `TaskBulkOp` exist for.

---

## 0. Setup

```bash
# terminal 1 — API (needs Mongo + GEMINI_API_KEY in server/.env)
cd server && npm run dev

# terminal 2 — web
npm run dev
```

Without `GEMINI_API_KEY` the propose route returns **503 `ai_not_configured`** — see §7.

### Preconditions: give it something to find

The seeded dataset assigns every domain from a hand-written template, so they are all
**already correct** and a run will honestly propose nothing. Misfile some first:

```bash
cd server
npx tsx scripts/scramble-domains.ts minamelad232@gmail.com 12   # prints each move
npx tsx scripts/scramble-domains.ts minamelad232@gmail.com --restore
```

The original domain rides along as a `was-<domain>` tag so `--restore` is exact. Those
tags are visible in the UI while scrambled — that is deliberate, so a half-finished
scramble is obvious rather than silently permanent.

---

## 1. The happy path

1. `/matters` → **Select** → tick 8–12 matters (include some you know are misfiled)
2. Tap **Categorize** in the bottom bar

**Expect, in this order:**

1. The sheet opens **immediately** — before the model has answered. This is the
   regression to watch for: it used to open on success, so the button looked dead for
   the several seconds Gemini takes.
2. Loading copy names the count: *"Kitto is re-reading 12 matters…"*, plus the boxed
   promise *"Nothing changes yet."*, plus three shimmer rows.
3. It resolves into a list. Each row: title, `oldArea → newArea` with both emoji chips
   (old struck through), `+tag` chips, and a short reason.
4. Rows the model was **confident** about are **pre-ticked**. `medium` / `low` are
   **not** — they show a `fairly sure` / `a guess` suffix on the reason.
5. Footer reads `Apply N`.

Tap **Apply**.

**Expect:** sheet closes, toast *"Refiled N matters."* with **Undo**, list re-renders
with the new areas, selection mode exits.

Tap **Undo** → every applied row returns to its previous area *and* its previous tags.

**Verify in Mongo:**
```js
db.taskbulkops.find({kind:'categorize'}).sort({createdAt:-1}).limit(1)
// status: 'applied' → 'undone' after undo; entries[] holds prior + next per task
db.tasks.find({_id: ObjectId("<a taskId from entries>")})  // domain back to prior
```

---

## 2. Partial accept — the one that must not regress

Untick roughly half the rows, then Apply.

**Expect:**
- Only the ticked rows change. Unticked matters keep their area **and** their tags.
- Undo restores **only** the rows that were applied.

**Verify in Mongo:**
```js
db.taskbulkops.find({kind:'categorize'}).sort({createdAt:-1}).limit(1)
// entries.length === the number you TICKED, not the number proposed
```

This is the load-bearing assertion. `applyProposal` narrows `entries` to the accepted
subset before writing; if it did not, Undo would "restore" a matter that was never
touched — quietly reverting an area the user had set by hand on that row.

---

## 3. Nothing to propose

Run `--restore` first so everything is filed correctly, then select ~10 matters and
Categorize.

**Expect:** empty state — *"Already filed right."* / *"Kitto read all 10 and would not
move anything. Nothing changed."* No footer buttons.

**Verify:** no `TaskBulkOp` is written at all (the one-open slot stays free), and the
AI quota slot is **refunded**:
```js
db.taskbulkops.countDocuments({kind:'categorize', status:'proposed'})   // 0
db.aiusagecounters.find({date:"<today UTC>"})                           // count NOT incremented
```

---

## 4. One open proposal at a time

Propose, then **close the sheet without applying or dismissing** (tap the X).
Now select different matters and tap Categorize again.

**Expect:** the sheet opens on the **previous** proposal rather than erroring. The
server answers `409 categorize_already_open`; the client treats that as "go look at the
open one", not as a failure, so there should be **no error toast**.

To clear it: **Dismiss** in the sheet footer.

**Verify:** the unique partial index is what guarantees this —
```js
db.taskbulkops.getIndexes()   // {userId:1, kind:1} unique, partial on status:'proposed'
```

---

## 5. It survives a reload

Propose, close the sheet, **reload the page**, Select → Categorize again.

**Expect:** the pending proposal comes back with its rows intact. The sheet reads from
`GET /me/tasks/categorize/pending`, not from React state, precisely so a proposal
someone walked away from is still there.

---

## 6. A matter is trashed while the proposal waits

Propose. Without applying, delete one of the proposed matters from the list. Reopen the
sheet.

**Expect:** that row is **gone** from the proposal, not offered as a change to a matter
that no longer exists. The remaining rows are unaffected.

---

## 7. Degradation

| Condition | Expect |
|---|---|
| No `GEMINI_API_KEY` | `503 ai_not_configured` → error state in the sheet, *"That didn't go through. Nothing was changed."* |
| Gemini call fails mid-run | The run reports whatever batches succeeded. It never throws; a failed batch is logged `categorize:batch-failed` and skipped. |
| Model invents a task id | Silently dropped — ids are checked against the batch that was sent. Never writes to an unrelated matter. |
| Model returns an unknown domain | Row dropped. `enum` in the response schema plus a server-side set check. |
| >80 matters selected | `400 categorize_too_many` — "Categorising works on up to 80 matters at a time." |

**The failure worth knowing about.** Gemini rejects an over-constrained response schema
with `400 … too many states for serving`, and because the service degrades to zero
rather than throwing, the symptom is a silent *"proposed 0"*. If you ever see 0 against
data you know is misfiled, check the log:

```bash
grep "categorize:batch-failed" <server log>
```

This is why `responseSchema` carries no `maxItems` — see the comment in
`server/src/modules/tasks/categorize/prompt.ts`.

---

## 8. Copy checks

- Bottom-bar label is **Categorize**. Not "File" (reads as the noun, and this app has a
  Documents tab full of actual files) and not "Tidy" (says nothing).
- Sheet title: `Reading your matters` while loading → `Where these belong` once loaded.
- The line above the checkboxes restates the deal at the moment of decision — the
  loading copy is gone by then.

---

## Automated coverage

```bash
cd server && npx vitest run src/modules/tasks/categorize   # 17 tests
```

Covers: prior/next recorded for undo, agreement dropped, tags additive + normalised,
invented ids ignored, bad confidence → `low`, unknown domain rejected, model failure
degrades, subset-apply narrowing, apply→undo round trip, double-apply refused,
cross-user access refused, trashed-row drop, discard.
