# Matters — the unified task/reminder workspace

## Context

Tasks now arrive from three ingest paths — chat (`toolRunner.ts` `createTask`), voice (`voiceCore/`), and document scan (`documentCore/`) — but there is nowhere to *live with* them afterward. Each path drops its output into Mongo and forgets it.

The gap is stark:

- **`/matters` is already declared as a tab** (`lib/appRoutes.ts:14`) with **no page behind it** and no `<Link>` in `components/ui/TabBar.tsx:19`. It is a reserved, wired, empty slot.
- **The client has no task list hook at all.** `queries/tasks.ts` is 39 lines wrapping one PATCH. `app/dashboard/page.tsx:38-47` renders three *hardcoded* `MatterRow`s, and `HomeHero.tsx:19` shows fake stats (`attention: 5`, `{all: 8, due: 5, resolved: 3}`).
- **`GET /me/tasks`** (`me.tasks.ts:74-120`) supports single-value `status`/`domain`/`priority`/`tag` + `dueBefore`/`dueAfter` + `limit`. No text search, no pagination, no sort control, no `kind` filter, no bulk endpoints, no counts.
- **No summarize/briefing endpoint exists.** The only trace is a comment at `Task.ts:187` ("Briefing filters by date range") and an orphan `NotificationPrefs.emailDigest` flag nothing reads.
- **No undo anywhere in the app.** No soft delete, no trash.

Intended outcome: `/matters` becomes the home of every reminder — organized, filterable, sortable, searchable in natural language, AI-summarizable over a time range, AI-categorizable with a reviewable diff, and safely bulk-editable with real undo.

### Research that shaped the design

External research (Reddit, product docs, UX literature) converged on three failure modes that kill task apps, and each drives a specific decision here:

1. **The overwhelm wall.** *"I'm just spending all of my time... trying to find tasks that I entered that seem to have disappeared entirely"* (r/todoist). → The default view is a **decision surface, not an inventory**. At most ~7 items above the fold; "everything" is one tap away, never the landing state.
2. **The overdue guilt pileup.** *"saw 62 overdue tasks staring back at me, and deleted the app on the spot"*; *"Each one is a tiny shame signal."* → **No raw overdue badge.** Overdue becomes a finite, swipeable **triage deck** with an ending, not an accumulating red count.
3. **Silent relocation destroys trust** (Gmail's category tabs are the decade-long case study). → **Categories label; they never move.** Every task stays findable where the user last saw it. Domains stay a closed set of 6 so category churn can't break saved views.

Plus one directly implementation-relevant complaint (Remember The Milk forums): *"you can't always tell that you've got 2 or more tasks selected because, if the list is long, then one of them has probably scrolled off the page."* → **The selection bar is pinned and the count never scrolls away.**

### Confirmed decisions

| Decision | Choice |
|---|---|
| Auto-categorize scope | Fix `domain` on existing tasks **+** propose `tags`; domains stay the closed set of 6 |
| AI search | NL → **editable filter chips** (deterministic predicate, drill-through, saveable as a view) |
| Delete safety | **Soft delete + Trash + undo toast**; every bulk op is one reversible transaction |
| Sequencing | Three phases, each independently shippable |

---

## Design language

Everything uses existing tokens (`app/globals.css` `@theme`; `docs/tokens.md` bans hex literals and Tailwind built-ins in components). Mobile-first inside `PhoneFrame` (390×844); `TabBar` floats at `bottom-4`, so list content needs bottom padding to clear it.

- Sections copy `components/scan/DocumentSections.tsx:47-69` — `text-label uppercase text-accent` header + count in `text-caption text-ink-subtle`, body one `divide-y divide-border rounded-lg border border-border bg-surface shadow-card` card.
- Filter/sort chips copy `TaskOverview.tsx:188-222` — `rounded-pill border px-2.5 py-1 text-caption`, selected `border-accent bg-accent/10 text-ink`.
- Overdue/due-today render **purple, not red** (`tokens.md`); `danger` is reserved for destructive confirms.
- Every date, count and duration gets `.tabular`.
- Sheets use `MorphPanel` (transient overlays); the triage deck uses `MorphSurface` (persistent state-driven).

Mobbin references: [Things 3 Today](https://mobbin.com/screens/feadd020-045b-477e-b54f-d4c405995a58) (time-bucket sections, sub-headings inside one screen), [Craft calendar](https://mobbin.com/screens/ec435482-bc7e-4b31-b800-174934fdd642) (date-grouped rows with source chips), [Asana My Tasks](https://mobbin.com/screens/e647ac91-4752-4859-b722-1fb62594f170) (filter/sort/fields chip row + collapsible groups), [Spotify Dates sheet](https://mobbin.com/screens/c6cba067-184c-4511-ae0d-37380982d3b2) (preset range chips above a calendar — the model for the date-range picker), [Gojek range picker](https://mobbin.com/screens/fb35ce6d-e1c7-4f38-adc1-634c52306680) (preset radio list + custom from/to), [Matter multi-select](https://mobbin.com/screens/0363f0b3-f0b8-4978-84eb-00263c56773a) (pinned "2 items selected" header + bottom action bar), [Evernote AI search](https://mobbin.com/screens/a0a19abf-d09a-49fa-b74b-5d715f42cf68) (answer card above real results — the AI-search layout), [Things 3 quick edit](https://mobbin.com/screens/07cc7ad2-a6ee-410b-a8a0-16cc5786ae65) (compact edit sheet).

---

## Phase 1 — Data layer + the list (no AI)

### Server

**`server/src/models/Task.ts`**
- Add `deletedAt?: Date`. Every read filter gains `deletedAt: { $exists: false }`.
- Add index `{ userId: 1, deletedAt: 1, status: 1, dueAt: 1 }`.
- Fix the stale comment at `:25` — `priorityRank` is documented as surfaced via `toJSON` but `toIdJSON` (`:104-109`) never adds it. Either add it or drop the claim; the client needs it for priority sort.

**New `server/src/models/TaskBulkOp.ts`** — the reversible-transaction record. `{ userId, kind: 'bulk' | 'categorize', action, status: 'proposed' | 'applied' | 'undone' | 'discarded', entries: [{ taskId, prior: {...}, next: {...}, confidence?, reason? }], createdAt, expiresAt }` with a TTL index (30 days). Serves both bulk ops (Phase 1) and categorization runs (Phase 3) — one model, one undo path.

**`server/src/routes/me.tasks.ts`** — extend `ListQuerySchema` (`:74-84`). It is `.strict()`, so every new param must be declared or requests 400.
- `q` — case-insensitive escaped regex over `title` + `notes`, scoped by `userId` (the userId index narrows first; adequate at personal-task scale and avoids Mongo's one-text-index-per-collection constraint).
- `kind` — the indexed field currently has no filter.
- `status`, `domain`, `priority`, `tag` — accept comma-separated multi-value → `$in`.
- `createdBefore` / `createdAfter`, `completedBefore` / `completedAfter`.
- `overdue`, `undated`, `untagged` — booleans.
- `sort` — `due-asc | due-desc | created-desc | created-asc | priority-desc | title-asc`, replacing the hardcoded `.sort({ dueAt: 1, createdAt: -1 })` at `:115`. Keep that as the default. Note dateless items sort `null`-first in Mongo ascending — push them last explicitly.
- `cursor` + `limit` → response becomes `{ tasks, nextCursor, total }` (additive; existing `{ tasks }` consumers keep working).

**New endpoints in `me.tasks.ts`**
- `GET /me/tasks/counts` → per-bucket counts (overdue, today, tomorrow, this week, later, undated, done) + per-domain + per-priority. Feeds the header, the filter badges, **and replaces `HomeHero`'s fake stats**.
- `POST /me/tasks/bulk/preview` → `{ ids? | filter?, action }` → `{ count, sample, warnings: { fromDocuments, remindersFired } }`. Powers the date-range delete confirm card.
- `POST /me/tasks/bulk` → applies, writes one `TaskBulkOp`, returns `{ affected, undoToken }`. Actions: `delete`, `complete`, `snooze`, `setDomain`, `addTags`.
- `POST /me/tasks/undo/:token` → restores from `entries[].prior`. Idempotent — an already-undone op returns 200 unchanged (mirroring `me.clarifications.ts:63-66`).
- `GET /me/tasks/trash`, `POST /me/tasks/:id/restore`, `DELETE /me/tasks/trash`.
- `DELETE /me/tasks/:id` (`:331-347`) → set `deletedAt` instead of removing.

**`server/src/modules/ai/toolRunner.ts`** — keep chat and UI parallel:
- Mirror the new filters into `queryTasksArgs` (`:137-145`) and `runQuery` (`:476-502`).
- `deleteTask` (`:102-104`) and `runDeleteAll` (`:443-454`) must **soft**-delete and write a `TaskBulkOp`. This makes the AI architecturally incapable of an irreversible delete — the safety must live in the handler, not the prompt.
- Mirror any new tool arg into `AI_TOOLS` in `provider/streamPersonal.ts` (the two declarations are hand-synced, per `toolRunner.ts:38-42`).

### Client

**`queries/keys.ts:11`** — `tasks: ['tasks']` becomes a factory (`all`, `list(filters)`, `counts()`, `detail(id)`, `trash()`). **Breaking:** three sites call `invalidateQueries({ queryKey: queryKeys.tasks })` and must become `queryKeys.tasks.all` — `queries/tasks.ts:35`, `queries/documentScans.ts:92`, `queries/clarifications.ts:63`.

**`lib/api/client.ts`** — add a small `toQuery(params)` serializer. None exists; `api()` takes the querystring baked into `path`.

**`queries/tasks.ts`** — grows from one mutation into the real data layer:
- A canonical `Task` interface matching the server model (today's `TaskRecord` at `:20-27` is a 6-field subset missing `status`/`kind`/`tags`/`subtasks`/`completedAt`/`snoozedUntil`/`reminders`).
- `useTasks(filters)` via `useInfiniteQuery`; `useTaskCounts()`; `useCreateTask`, `useUpdateTask` (widen `UpdateTaskBody` to the server's full PATCH schema — it currently omits `status`, `tags`, `snoozedUntil`), `useDeleteTask`, `useCompleteTask`, `useSnoozeTask`, subtask mutations, `useBulkPreview`/`useBulkAction`/`useUndoBulk`.
- Optimistic pattern copied verbatim from `queries/clarifications.ts:83-94` — `onMutate` remove/patch, `onError` restore, `onSettled` invalidate.
- The domain/priority enums are currently duplicated in three places (`queries/documentScans.ts:11`, `components/scan/candidateDisplay.tsx:19-27`, `components/icons/DomainIcon.tsx`). Make `queries/tasks.ts` the single source and re-export.
- `queries/ai.ts` has two `TODO(tasks-query)` seams (`:166-168`, `:307-308`) for invalidating a tasks cache once one exists — wire them.

### The page — `app/matters/page.tsx` + `components/matters/`

Model the shell on `app/documents/page.tsx` (skeleton → empty → content, `AnimatePresence`-wrapped overlay).

```
AppHeader
┌ 🔍 Search or ask…                    🎤 ┐   sticky
[ active filter chips · horizontally scrollable ]
[ Filter ⚙ ]  [ Sort ⇅ ]  [ Select ]

  ▸ 12 matters slipped. Sort them out →      ← only when overdue > 0

  ▾ TODAY          3
  ▾ TOMORROW       2
  ▾ THIS WEEK      7
  ─────── 142 more · Show all ───────         ← tap, not scroll
```

Default grouping is **smart time buckets** (Overdue → Today → Tomorrow → This week → Later → No date → Done, collapsed). Switchable to group-by-domain / by-priority / flat. Grouping is a **lens** — it never mutates the task.

Components:
- `MattersSearchBar.tsx` — input + mic. Phase 1: plain `q`. Phase 2: NL compile.
- `FilterSheet.tsx` (`MorphPanel`) — domain pills, priority pills, kind, status, tag multi-select fed by **`GET /me/tasks/tags` (`me.tasks.ts:125-134`), which already exists and is unused by any client code**, plus date-range presets (Today / This week / This month / Next month / Custom) over a custom from–to.
- `SortSheet.tsx`.
- `MatterListRow.tsx` — extend `components/dashboard/MatterRow.tsx` with optional `id`/`onPress`/`selected`/`priority`/`tags`/`subtaskCount` so the dashboard and styleguide keep working unchanged. Keep its exact visual DNA. Add swipe: **right = Done, left = Snooze** only (NN/g: at most two, identical app-wide, undo highly salient). Delete never lives on a swipe.
- `MatterDetailSheet.tsx` — **lift the inline editor from `components/scan/TaskOverview.tsx:166-275` into a shared component**: title input, domain pill row, priority pill row, `datetime-local` + Clear, notes textarea, Cancel/Save with `isPending`. It is already exactly the editor needed. Reuse its `toLocalInputValue`/`fromLocalInputValue` (`:31-43`) and the diff-only patch builder (`:91-111`), and delete the verbatim duplicate in `ScanReviewCard.tsx:34-46`.
- `SelectionBar.tsx` — pinned above the TabBar, count always visible. Actions: Complete · Snooze · Categorize · Delete · Cancel. Selection state lives **outside** the rendered window so virtualization can't drop it. Multi-select model follows `ScanReviewCard.tsx:67,101-126` (`Set<string>` + batched submit).
- `BulkDeleteConfirm.tsx` — resolved **absolute** dates, exact count, ripple warnings ("3 came from scanned documents", "8 already fired reminders"), scrollable preview, then confirm. Never delete straight from a parsed range.
- Undo toast via the existing `MorphToast` + `sonner`.
- Empty/complete states use `SketchEmptyTrayGlyph` — the empty state is the product's best moment, not a grey apology.
- Virtualize past ~150 rows with sticky section headers.

**Also:** add the missing `<Link href="/matters">` to `components/ui/TabBar.tsx:19`, and swap `app/dashboard/page.tsx:38-47` + `HomeHero.tsx:19` onto real `useTasks`/`useTaskCounts` data.

---

## Phase 2 — AI search + summarize

**`POST /me/tasks/search/compile`** — NL → structured predicate. Gemini structured output following the `voiceCore/extract.ts:159-211` template exactly: `responseSchema` + `responseMimeType: 'application/json'` + `temperature: 0`, wrapped in `withGeminiRetry`, then **re-validated with the same `ListQuerySchema`** so an invalid compile is caught server-side rather than 400ing the list call. Returns `{ filter, chips: [{ key, label, value }], explanation }`.

The chips are the whole point: they make a wrong interpretation *diagnosable* instead of magic-that-failed. Every chip is removable, the result count is live, and "Save as view" persists both the original NL string and the compiled predicate (so a saved view can be re-explained later). Mic reuses the existing `POST /ai/voice/transcribe` (`ai/routes.ts:365`) — transcribe, then compile; **never** route a destructive intent through voice without a visual confirm card.

**`POST /me/tasks/summarize`** `{ from, to }` — structured output, not prose. Fixed schema:

1. Counts with deltas vs the prior equal-length period
2. Themes — each with count + 2 example titles + `taskIds`
3. What slipped — rescheduled ≥3× or overdue >14d, named individually
4. Finished-but-unplanned (completed with no prior due date) — captures reactive work
5. Patterns — heaviest day, average time-to-close
6. **One question** — e.g. "You've moved 'renew passport' 5 times. Is this still real?" with Yes / Snooze 3mo / Drop inline

Every number carries `taskIds` and renders as a link that sets the list filter. A summary that can't be drilled into is a hallucination surface.

`SummaryCard.tsx` layout follows the [Evernote AI search](https://mobbin.com/screens/a0a19abf-d09a-49fa-b74b-5d715f42cf68) pattern — answer card above real, tappable results.

Reuse `modules/ai/quota.ts` (`admitWithinQuota`/`recordUsage`/`releaseUsageSlot`) and `middleware/rateLimit.ts` on both endpoints. `contextBuilder.buildPersonalContext` (`:77-174`) and `buildDateReference` (`:187-223`) already assemble a date-grounded task digest that the summarizer can reuse near-verbatim.

---

## Phase 3 — Auto-categorize + triage

**Propose → review → apply**, reusing the Clarification mechanics wholesale.

- `POST /me/tasks/categorize/propose` → writes a `TaskBulkOp` with `kind: 'categorize'`, `status: 'proposed'`. Per entry: `{ taskId, currentDomain, proposedDomain, proposedTags, confidence, reason }`. Reuse the `confidence` / `reviewReason` enums from `voiceCore/contract.ts:33-49` verbatim, and the server-side `hardenItem()` discipline (`extract.ts:214-267`) — an unknown domain parks rather than drops.
- `POST /me/tasks/categorize/:runId/apply` `{ acceptedTaskIds }` → applies **through `runTool({ name: 'updateTask' })`**, exactly as `me.clarifications.ts:117-123` does, so validation, timezone normalization and reminder rescheduling stay in one place. Idempotent: a non-`proposed` run returns 200 unchanged.
- `POST /me/tasks/categorize/:runId/discard` → `status: 'discarded'`. This is the "cancel anywhere".
- Undo reuses `POST /me/tasks/undo/:token` — one run, one transaction, one tap to reverse.

`CategorizeReview.tsx` — grouped by change type, **high-confidence rows pre-checked and low-confidence unchecked** so attention lands where it's needed, one-clause reason per row, accept-all per group, global Discard/Apply. Client mutations copy `queries/clarifications.ts:83-94`.

This is strictly better than Apple's iOS 26 Auto-Categorize, whose documented recovery path is *"try turning off Auto-Categorize and removing the sections, then turning it back on"* — a reroll, not a diff.

**`TriageDeck.tsx`** — **reuse `components/uncertainty/UncertaintyStack.tsx` verbatim**: queue snapshotted at mount so optimistic removals don't reshuffle (`:49`), `MorphSurface` height per card (`:80-82`), progress dots, terminal "All clear." state (`:87-94`). Verbs: **Today / Tomorrow / Pick a date / Snooze**. Entered from the "N matters slipped" banner. Finite, with an ending — this is what converts the app's most app-killing emotion into a satisfying ritual.

**Provenance** — any task whose domain/tags were AI-set carries one line: *"categorized as Health — mentions 'dentist'"*. Nearly free if `reason` is persisted on the `TaskBulkOp` entry, and it is the direct fix for the black-box complaint that drives users off Motion.

---

## Deferred (documented, not built)

Worth doing later, deliberately out of scope: `startDate` vs `dueAt` split (Things 3's model — the deepest fix for overdue pressure, but a real schema migration); "Not doing this" as a terminal state; saved smart views beyond a single active one; duplicate detection at capture; reminder-load conflict warnings (`docs/smart-reminder-conflict-spec.md` already exists); offline mutation queue.

---

## Verification

**Types + lint** — `npm run typecheck && npm run lint` (root, covers `app components lib queries`); `cd server && npm run type-check`.

**Server tests** — `cd server && npm test`. Extend `server/src/routes/me.tasks.test.ts`, which already exercises the task routes:
- Each new list filter in isolation and combined; `.strict()` rejects unknown params with 400 `invalid_query`.
- Sort orders, including dateless-items-last.
- Cursor pagination: no duplicates, no gaps across pages.
- Soft delete — deleted tasks absent from list, present in trash, restorable.
- Bulk preview count matches bulk affected count.
- Undo restores prior values exactly; undoing twice is a no-op.
- Cross-user isolation on every new endpoint (404, never 403-leak).
- Categorize apply is idempotent; discard blocks a later apply.

**AI endpoints** — `server/scripts/nl-eval.ts` (`npm run nl-eval`) is the existing adversarial harness. Add cases for search compilation: "insurance stuff I've been putting off", "what's overdue from last month", "everything about the car", "unscheduled things older than two weeks" — assert the compiled predicate, not the prose. Per the existing eval memory, don't re-tune the chat agent's accepted-flaky cases while doing this.

**End-to-end** — `npm run dev` + `cd server && npm run dev`, then at `/matters`:
1. Seed via all three ingest paths (chat, voice, a document scan) and confirm every task appears in one list.
2. Filter by domain + priority + date range; confirm counts in the header match the rows.
3. NL search → verify the chips are correct and removable → Save as view.
4. Select 3 tasks → bulk snooze → **undo** → confirm exact prior state.
5. Date-range delete → confirm the preview shows resolved absolute dates, the exact count, and the ripple warnings → delete → undo from the toast → verify restored → delete again → find them in Trash.
6. Summarize a month; tap a number and confirm it drills into a correctly filtered list.
7. Auto-categorize; uncheck one row, apply, verify only checked rows changed and the run is undoable.
8. Overdue triage deck end-to-end to its terminal state.
9. Verify tasks are never *relocated* by categorization — everything remains present in the unfiltered list.

**Mobile shell** — check in `PhoneFrame` at `lg:` that the sticky search bar, pinned selection bar, and floating `TabBar` don't collide, and that sheets clip to the phone rather than the browser viewport. Then `npm run cap:sync:dev` and spot-check on device, since `trailingSlash: true` static export is what `normalizeRoute` compensates for.

**Accessibility/perf** — 500+ seeded tasks to confirm virtualization and the 100ms interaction budget; verify `prefers-reduced-motion` disables the morph transitions (`MorphSurface` already handles this).
