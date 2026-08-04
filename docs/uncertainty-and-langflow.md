# Uncertainty: how Kitto asks, how the card renders, and what Langflow would change

How a genuinely-ambiguous item becomes a question, how that question reaches the user as a card in
chat and on `/uncertainties`, and what an orchestration swap to Langflow would actually cost.

Written against the code as of `feat/profile-account`.

---

## 1. How the AI decides to ask

The model never "asks" in prose. Asking is a **tool call**: `holdForClarification`.

The policy lives in the system prompt at `server/src/modules/ai/voice/toolRules.ts:95`, and the
discriminator is **cost of being wrong** — not "is there a date".

| Situation | What the model does |
|---|---|
| Nameable item, has a date (even soft: "around the 20th") | `createTask` now, `kind: 'reminder'` |
| No date, no stakes ("buy bread") | `createTask` now, `kind: 'list'`, no date |
| No date, **low** cost (a wrong nudge just gets rescheduled — "call the bank") | `createTask` with a defaulted date, and it *states* the time it picked |
| No date, **high** cost (bill, flight, court, passport expiry) | `holdForClarification` — asks the *deadline-defining* question ("When is it due?"), never "when should I remind you" |
| Two dates floated ("the 15th or the 18th") | `holdForClarification`, kind `date`, one option per date |
| Unnameable ("email that guy about the thing") | `holdForClarification`, kind `detail`, **options empty**, one question asking who *and* what |
| Duplicate inside the same message | Held or created **once**, never twice |

Two rules carry the design:

- **The iron rule** (`toolRules.ts:163`) — every item the user said becomes a real task in that same
  turn. A hold is not a withheld task: it creates the task *and* attaches the question. What gets
  withheld on a high-cost guess is the **reminder**, never the item.
- **`urgent` + no date is a contradiction** — maximum importance, zero chance of firing. It is never
  persisted; the model must either default a very-soon reminder (and say so) or hold.

This is the HAX G10 position stated in `server/src/models/Clarification.ts:6` — uncertainty gets
disambiguated *or* degraded gracefully and acted on. Withholding indefinitely is neither, and that
is what the schema comment records as the old, wrong behaviour.

## 2. What the server does when the tool fires

`runHoldForClarification` — `server/src/modules/ai/toolRunner.ts:329`:

1. **Pick the best guess date** — explicit `dueAtGuess`, else `options[0].dueAt` (the model is told
   to order options most-likely-first), normalized through the same `normalizeLocalIso` that
   `createTask` uses. A picked option therefore lands the identical instant a create would have.
2. **Create the Task first, always.** `kind` = `'reminder'` only when there is a date *and*
   `costOfWrong === 'low'`; otherwise `'list'` — a passive matter that will not fire on an invented
   date.
3. **Cap check** (`openClarificationCap.ts`) — if the open-question queue is full, the task is the
   whole answer and no question is persisted (`queueFull: true`). No infinite pile.
4. **Persist one `Clarification` row** (`createClarification.ts:32`) with `draft`, `question`,
   `kind`, `costOfWrong`, and up to 4 pre-resolved `options`.
5. **Return `{ clarificationId, taskId, task }`** — this is what makes the card renderable.

Args are validated by Zod before any of it (`toolRunner.ts:189`): `question` ≤ 300 chars,
`kind ∈ {date, detail, choice}`, `options` max 4, ISO dates must carry a literal `T` plus an explicit
offset. A malformed hold is rejected with an actionable error the model can retry against — it never
reaches the UI half-formed.

Voice notes take the same road, idempotently: `upsertVoiceClarification.ts` keys on a note-scoped
`sourceKey` behind a partial unique index, so a worker retry cannot duplicate a held item or
resurrect one the user already answered.

## 3. How it becomes a clean card

Two surfaces, one row.

### In chat

The SSE stream emits `tool_call` then `tool_result` (`queries/ai.ts:185,197`), which merge into
`AiToolCall { name, args, result }` on the message. `components/chat/ChatMessage.tsx:54-64` splits
one turn's tool calls three ways:

```
receipts       → executed mutations       → tight ledger rows (verb · title · date · priority · category)
confirms       → the deleteAllTasks prompt → its own card
clarifications → ALL holds in the turn     → ONE ClarificationDeck
```

`components/chat/ClarificationDeck.tsx` is the key piece: three held items do **not** become three
alerts. They become one surface with "Question 1 of N", dot progress, Back, and a Dynamic-Island
morph between questions (fade out → spring height → fade in, `MORPH_CONTENT_VARIANTS` +
`MORPH_SPRING`). Chips come from `args.options[].label`, and each chip carries its **index into the
server's options array** (`parseHold`, line 66) — so answering sends `{type:'option', index}`, not a
string the server has to re-interpret.

A held item also earns a ledger receipt, carrying the guess that was applied (date · priority ·
category, flagged when the date will not fire — `lib/ai/toolCallSummary.ts`). The deck owns the
question; the receipt owns the guess. Before that split, the one thing the user was being asked to
correct was invisible.

The card is clean for one structural reason: **the model supplies data, not layout.** The prompt
forbids re-typing the question as prose, listing the options in text, or pointing the user at the
home screen (`toolRules.ts:148`). The lead-in line only says the item is already filed — "All filed.
One of them I guessed a date for — fix it if I got it wrong." The question exists exactly once, in a
typed field.

### On `/uncertainties`

`components/uncertainty/UncertaintyStack.tsx` fetches `GET /me/clarifications` — open, not deferred,
newest first. `visibleOpen()` (`Clarification.ts:164`) is the single definition of "should the user
see this", composed by the list, the dashboard count and the digest so the three cannot disagree.

The list is snapshotted at mount and walked one `MorphSurface` card at a time, so optimistic removals
never reshuffle the walk. Card height is computed from the option count, so the shell springs to fit.

## 4. Answering

`POST /me/clarifications/:id/resolve` — `server/src/routes/me.clarifications.ts:93`:

- **Option pick → zero AI.** Merge that option's `dueAt` / `title` / `notes` onto the existing task.
  Deterministic, instant, free.
- **Typed answer → one bounded Gemini call.** `resolveClarificationAnswer.ts:94` forces a single
  `createTask` function call (`mode: ANY`, temperature 0, thinking budget 0), then routes those args
  back through `toolRunner.updateTask` — same validation, same timezone normalization as any
  chat-created task.
- **A confirmed date promotes the task** `kind: 'list' → 'reminder'` (line 187). That is the moment a
  withheld reminder starts firing — the whole point of having asked.
- **Idempotent.** An already-resolved row echoes its state instead of creating a second task. If the
  task was deleted meanwhile, the question is closed as `dropped`, not resurrected.
- **`defer`** = a real 7-day cooling-off window on the server, not a local index bump.
  **`drop`** = discard.
- Terminal actions use an atomic `$set` (`closeOut`), not `doc.save()` — legacy rows missing the
  required `taskId` would otherwise fail whole-document validation and 500 forever.

Both surfaces remove optimistically and roll back with a toast on failure
(`queries/clarifications.ts:147`), and the dashboard's "needs input" count moves in the same tick.

## 5. The full path, end to end

```
user message
   │
   ▼
Gemini + TOOL_RULES ──► holdForClarification(title, domain, question, kind, costOfWrong, options[])
   │                        │
   │                        ▼  Zod validate → normalizeLocalIso
   │                    createTask   (kind 'list' if high-cost guess, else 'reminder')
   │                    cap check    (queue full → task only, no question)
   │                    Clarification row {draft, question, kind, costOfWrong, options}
   │                        │
   ├── SSE tool_call/tool_result ──► AiToolCall.result.clarificationId
   │                                     │
   │                                     ▼
   │                            ClarificationDeck   (chat, N questions → 1 card)
   │
   └── GET /me/clarifications ──► UncertaintyStack  (/uncertainties, card walk)
                                        │
                     option index ──────┤────── typed text
                     (no AI)            │       (1 bounded Gemini call)
                                        ▼
                             POST /:id/resolve → toolRunner.updateTask
                                        │
                             kind → 'reminder' if the date is now confirmed
```

---

## 6. If you orchestrate with Langflow

First, the honest framing: **Langflow is not the same class of tool as what
`docs/GRADUATION-PLAN.md:106` already picked.** LangGraph.js is a library that runs *inside* the
Express process. Langflow is a separate Python service with a visual canvas, called over HTTP. Using
it means adding a second runtime and a network hop to the hot path of every chat turn.

That said, here is what it would actually look like.

### The only architecture that doesn't wreck the invariants

**Langflow orchestrates. Node stays the system of record.**

```
Browser ── SSE ──► Next.js / Express            (wire contract unchanged)
                        │  quota admission, auth, userId injection
                        ▼
                   Langflow   POST /api/v1/run/{flow_id}?stream=true
                   ├─ Agent component (Gemini)   ← session_id = conversation id
                   └─ Tools (custom components, tool_mode=True)
                         └─ each POSTs to an internal tool endpoint
                                 ▼
                        toolRunner.runTool()     ← Zod, normalizeLocalIso,
                                                    cap, idempotency, Mongo
```

Each of the 11 tools becomes a Langflow **custom Python component** with `tool_mode=True`, and its
body is ~10 lines: an HTTP POST to a service-authenticated `/internal/tools/:name` on the Express
server, carrying the `userId` the *server* injected — never one the flow or the model supplied. All
the correctness stays where it lives today.

### Making the card still render cleanly

The card contract survives untouched, because it reads the **persisted `Clarification` row**, not the
model. `ClarificationDeck.tsx` and `UncertaintyStack.tsx` need zero changes. Two ways to feed them:

1. **Structured Response.** Langflow's Agent component has a built-in Structured Response output with
   an Output Schema you define field-by-field — mirror `holdForClarificationArgs` there (title,
   domain, priority, question, kind, costOfWrong, options[label, dueAt]). Then re-validate with the
   existing Zod schema at the Node boundary. Langflow's schema editor is weaker than Zod: no
   `max(4)`, no regex on the ISO offset, no cross-field refine. **Langflow's schema is a hint; Zod
   stays the gate.**
2. **Refetch.** The hold component writes through the internal endpoint, the flow ends, and the
   client just invalidates `/me/clarifications`. Simplest, costs one round trip, and `/uncertainties`
   already works exactly this way.

### The real cost, itemized

| What exists today | Under Langflow |
|---|---|
| `tool_call` / `tool_result` SSE frames the client parses byte-for-byte | Langflow streams `add_message` / `token` / `end`. The tool frames are **not** in that shape — Express must consume Langflow's stream and re-emit the existing contract, extracting tool activity from message content or a structured payload. Highest-risk piece. |
| `deleteAllTasks` confirm gate | Langflow has no durable `interrupt()` equivalent. End the flow, hold the pending call in Mongo (`pendingToolStore` + `AiConversation.toolCalls` already do this), start a *second* run on confirm. Workable, not elegant. |
| Zod + `normalizeLocalIso` + open-question cap + `sourceKey` idempotency | Keep all of it in Node. Do **not** reimplement in Python components. |
| Per-user auth | A Langflow API key identifies the *app*, not the user. `userId` must be injected server-side per run (tweak / global var) and re-checked on every internal tool call. |
| 41 test files, `toolRunner.test.ts` untouched by the LangGraph plan | Same — as long as tools stay thin HTTP wrappers over `runTool`. |
| One Node deployment | Two services, one of them Python, plus flow JSON as a versioned artifact in git. |

### Recommendation

The plan already scoped LangGraph.js at 7.5–10 days with a one-env-var rollback and a byte-identical
SSE contract. Replacing that with Langflow buys the same rubric point ("named agent framework") at a
higher price.

But Langflow has one thing LangGraph does not: **it demos beautifully** — a visual graph on a slide
is worth real marks.

So the pragmatic split: keep LangGraph.js owning the chat loop, and use Langflow for **one narrow,
stateless sub-flow** where a wrong result is cheap and the contract is a single structured object.
`resolveClarificationAnswer.ts` is the ideal candidate — already one bounded call, one function
output, no state, no confirmation gate, and already isolated behind a "throw and keep the row open"
failure mode. That yields a real Langflow graph to show, on the one node where a Python round trip
costs nothing and cannot corrupt anything.

---

## Reference — the files that matter

| Concern | File |
|---|---|
| When to ask (prompt policy) | `server/src/modules/ai/voice/toolRules.ts:95` |
| Tool args schema (Zod) | `server/src/modules/ai/toolRunner.ts:189` |
| Hold dispatch: create task, cap, persist | `server/src/modules/ai/toolRunner.ts:329` |
| Row shape, kinds, costs, `visibleOpen()` | `server/src/models/Clarification.ts` |
| Chat-born hold writer | `server/src/modules/clarifications/createClarification.ts` |
| Voice-born hold writer (idempotent) | `server/src/modules/clarifications/upsertVoiceClarification.ts` |
| List / resolve / defer / drop routes | `server/src/routes/me.clarifications.ts` |
| Typed-answer interpreter (1 Gemini call) | `server/src/modules/ai/resolveClarificationAnswer.ts` |
| Turn → receipts / confirms / deck split | `components/chat/ChatMessage.tsx:54` |
| The consolidated in-chat card | `components/chat/ClarificationDeck.tsx` |
| The `/uncertainties` card walk | `components/uncertainty/UncertaintyStack.tsx` |
| Client cache + optimistic removal | `queries/clarifications.ts` |
| Ledger receipt fields (the guess) | `lib/ai/toolCallSummary.ts` |

## Sources

- [Flow trigger endpoints — Langflow docs](https://docs.langflow.org/api-flows-run)
- [Create custom Python components — Langflow docs](https://docs.langflow.org/components-custom-components)
- [Structured Output — Langflow docs](https://docs.langflow.org/structured-output)
- [Use Langflow agents — Langflow docs](https://docs.langflow.org/agents)
