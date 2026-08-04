# Kitto — Graduation Plan (Track A)

> Written 2026-08-04. Runs **before** [`LAUNCH-PLAN.md`](LAUNCH-PLAN.md) (Track B).
> Built against the two reviewer documents at the repo root:
> `Project Improvement Notes.pdf` (feedback across all 15 projects) and
> `Graduation Project Pitch Video Guidelines.pdf` (the 10-minute pitch structure).
>
> **What Kitto is, for the avoidance of doubt:** a life-admin **reminder** product. You speak a
> sentence or scan a document; it extracts the deadline, files it into one of six life domains, and
> reminds you before it lapses. It does not handle money, compare prices, or give financial advice.
> Amounts appear only as a property of a reminder (`Pay £142.37 by 30 July`), which is what
> `docs/features.md` #3 has specified since v1.

---

## 1. The rubric, and where Kitto stands

`Project Improvement Notes.pdf` asks six things of every project. Verified against the code today:

| # | Rubric item | Status | Gap |
|---|---|---|---|
| 1 | **Named LLM + why you chose it** | ⚠️ Partial | `gemini-2.5-flash` is used throughout (`server/src/env.ts`), but **the justification is written nowhere.** Reviewers call out "GPT-based models"-style vagueness explicitly. |
| 2 | **Named agent framework** | ❌ **Absent** | Hand-rolled tool loop (`modules/ai/service.ts` + `toolRunner.ts`, `MAX_TOOL_ROUND_TRIPS`). Grep for `langgraph\|langchain\|semantic-kernel` returns **zero**. Reviewers note only 1 of 15 projects named one. **Decision taken: migrate to LangGraph.js.** |
| 3 | **RAG setup** (vector DB, chunking, embedding model) | ❌ **Absent** | No vector DB, no embeddings, no chunking — grep for `embedding\|vectorSearch\|pinecone\|chroma\|qdrant\|faiss` returns **zero**. `modules/tasks/semanticSearch.ts` hands the model a bounded pool of tasks and it returns ids — that is LLM re-ranking, **not retrieval**. See §3 for the decision. |
| 4 | **AI monitoring (Langfuse)** | ❌ **Absent** | No Langfuse, no OpenTelemetry, no Sentry. Reviewers: *"Security and Observability: Near-Zero Across the Batch."* |
| 5 | **Deployment plan** (testing, CI/CD, Docker, hosting) | ❌ **Absent** | No Dockerfile, no `.github/`, no host config anywhere. `.env.production` → `api.example.com`. **Zero frontend tests** (backend has 513 across 41 files, none skipped). |
| 6 | **Security section** | ⚠️ Raw material exists | Nothing written, but the eight audits produced the content. See §5. |

Plus two batch-wide notes that cut in Kitto's favour:

- **"Egyptian/Arabic localization… can give your project a strong competitive advantage. Clearly highlight it in your pitch."** Kitto already ships English + Arabic with full RTL — 705 keys, both locales, **zero drift** (`npm run check:i18n`), a `check:rtl` linter, and a pre-paint direction script in `app/layout.tsx:90`. Very few student projects will have this actually working. **Lead with it.**
- **"Strong Concepts, Weak Specifications"** — pitches explain *what* but not *how*. Kitto's problem is the reverse: the build is far ahead of the write-up. §6 fixes that.

> **Check before starting:** the notes say projects flagged **BLOCKING** must resolve each issue *in
> writing and submit for review* before writing implementation code, and name LLM misalignment, RAG
> design, and agent-framework migration as the three that are expensive to change mid-development.
> Confirm whether Kitto was flagged. If it was, §2–§4 are submissions, not just tasks.

---

## 2. LLM justification (rubric #1)

Written answer for the pitch. Every claim here is verifiable in the code.

**Choice: Gemini 2.5 Flash.** The deciding factor is that Kitto sends **three different input modalities
to one model**, and swapping in a text-only LLM would require bolting on two more vendors:

| Input | Where | Why it rules out text-only models |
|---|---|---|
| **Audio** (voice notes) | `modules/ai/audioTranscriber.ts:96` — raw audio inline | Otherwise needs a separate STT vendor (Whisper/Deepgram) plus its own failure and cost path |
| **PDF** (multi-page documents) | `modules/ai/documentCore/extract.ts:217` — full PDF inline base64 | Otherwise needs an OCR/parsing vendor, and OCR **discards layout** — which matters, because the extractor reads policy schedules and renewal boxes where spatial position carries meaning |
| **Images** (camera captures) | same path | Same |

Supporting reasons, in order of weight:

1. **Structured output.** Every extraction path uses `responseSchema` with `Type` from `@google/genai` and validates the result through Zod — so the model returns typed data, not prose to be regex'd. `documentCore/contract.ts` makes every field `.nullish()` so a partial answer degrades instead of failing the parse.
2. **Arabic.** Kitto ships Arabic + RTL; Gemini handles Arabic input and output natively, which the product's `promptLanguage.ts` rules depend on.
3. **Cost.** Measured, not estimated: ~$3.26/engaged user/month today, ~$1.79 after the optimizations in `LAUNCH-PLAN.md` §3.4. See §7.
4. **Thinking budget control.** `thinkingConfig.thinkingBudget` lets latency-sensitive paths (chat) trade reasoning for speed while extraction keeps it. Three call sites already use this; nine more should (`LAUNCH-PLAN.md` §3.4 lever 2).

**Honest limitation to state in the pitch, not hide:** benchmarked document-extraction accuracy tops out around 90–94% on *clean* documents. That is why `AGENTS.md` makes provenance non-negotiable — every AI-derived value renders with its source page, and anything below the confidence threshold is routed to `holdForClarification` (which asks the user) rather than becoming a reminder. **Reviewers respond better to a named limitation with a designed mitigation than to a claim of 99% accuracy.**

---

## 3. RAG decision (rubric #3)

Kitto has no RAG today. The rubric is conditional (*"If you're using RAG, mention…"*), so "no RAG,
here's why" is a legitimate answer. But there is a better one available cheaply.

### Recommendation: add a scoped RAG over the user's own document corpus

Three reasons it's the right call here rather than rubric theatre:

1. **The schema slot already exists and is unused.** `models/ScannedDocument.ts:98,158,192` declares `rawExtractedText` — schema'd, stripped from JSON responses, and **never written**. The field RAG would chunk is already designed.
2. **It fixes the citation gap, which is the app's stated #1 risk.** `AGENTS.md` requires every AI-derived value to carry provenance, and the completion audit found `CitationChip` **does not exist** — extraction stores only `sourcePage`, no verbatim text. Retrieval produces exactly the missing artifact: the chunk, its page, and its text. **RAG and the trust contract are the same piece of work.**
3. **It answers a question the current architecture cannot.** `contextBuilder.ts` assembles context by direct indexed Mongo queries over *tasks*. Nothing can answer *"what does my car insurance say about windscreen cover?"* — the document text is never in context. That is a real capability gap in a product whose pitch is "it understands your documents."

**Proposed setup, stated in rubric terms:**

| Component | Choice | Reasoning |
|---|---|---|
| **Vector store** | **MongoDB Atlas Vector Search** | You are already on Atlas and mongoose. No second datastore, no sync problem, and per-user filtering is a normal Mongo query — which matters because every vector query **must** be scoped by `userId` (see the security note below). Alternative if staying self-hosted: `pgvector`, but that adds a database. |
| **Embedding model** | **`gemini-embedding-001`** | Same vendor, same API key, same SDK already installed. Multilingual — important because the corpus is English *and* Arabic. |
| **Chunking** | **Page-aware, ~800 tokens, ~100 overlap** | Chunk boundaries must not cross pages, because the page number *is* the citation. `lib/pdfPageCount.ts` already exists. This is the one chunking decision that is product-driven rather than convention. |
| **Retrieval** | top-k = 5, filtered by `userId`, then re-ranked by the model | Mirrors the pattern `semanticSearch.ts` already uses (bounded pool → model picks → validate ids against the same pool, so it cannot invent or reach another user's document). |

**Security note to include in the pitch (this scores on rubric #6 too):** the vector query is filtered
by `userId` *in the query*, not after retrieval — a per-user corpus with post-filtering is a
cross-tenant leak waiting to happen. And retrieved document text is **untrusted input**: it is
AI-extracted prose from whatever was on a scanned page, so it must be delimited as data and must
never be able to trigger a state-changing tool. That risk is live in the current code —
`contextBuilder.ts:141` interpolates raw `task.notes` into a prompt that always has function-calling
attached, while `toolRunner.ts:239` gates only `deleteAllTasks`.

**Effort: ~5 days.** Backfill `rawExtractedText` on the existing extraction path (1d), embedding +
chunking pipeline in the document worker (2d), Atlas vector index + retrieval node (1d), wire into
the LangGraph context node and the citation chip (1d).

**If time runs out**, the fallback answer is defensible and should be written down either way:
*"Kitto deliberately does not use RAG for task context. The corpus is small, per-user, and fully
structured, so retrieval is done by indexed MongoDB queries on typed fields — which is exact rather
than approximate, and cheaper. RAG is scoped for document Q&A, where the corpus is unstructured."*

---

## 4. Agent framework — LangGraph (rubric #2)

**Decision taken. Scoped in detail. Effort: 7.5–10 days** — see §9 for what that does to the schedule.

### The decision that shapes everything else: don't use LangChain's Gemini wrapper

`@langchain/google-genai` depends solely on `@google/generative-ai`, which reached **end-of-life on
31 Aug 2025** — over eleven months ago. LangChain's own current docs say the wrapper *"will be
deprecated… new implementations should use the ChatGoogle library instead."* The replacement,
`@langchain/google`, is **v0.2.1, first published about six weeks ago.** One option is mature but
dead-ended; the other is current but immature.

**So adopt neither.** Keep `provider/streamPersonal.ts` calling raw `@google/genai` exactly as it does
today, and let LangGraph own only the control flow — nodes call `streamPersonal()` and relay its
events through `config.writer(...)`. This is a **first-party-endorsed pattern**: LangGraph's own docs
have a "Use with any LLM" section demonstrating precisely this, and the README states LangGraph
*"can be used without LangChain."*

This is also the honest rubric answer, and a better one than uniformity: **the graph genuinely owns
the round-trip loop, the confirmation gate, and durable pause/resume.** It is not a decorative import.
Nothing about the Gemini wire behaviour — tool declarations, `thinkingConfig`, temperature, streaming
shape — changes, which is exactly why the existing tests keep working as the safety net.

### Verified compatibility (dry-run against the real lockfile, not assumed)

| Check | Result |
|---|---|
| Zod migration | **None needed.** Resolves to `3.25.76` before *and* after; the new peers accept `^3.25.32 \|\| ^4.2.0` |
| Node version | **No change.** Already requires ≥20 via `@google/genai` |
| Dependency weight | **+22 packages** (479 → 501). Backend, so no browser bundle cost |
| Packages | `@langchain/langgraph@1.4.9`, `@langchain/core@1.2.4`, `@langchain/langgraph-checkpoint-mongodb@1.4.0` — **pin exact, not `^`**; the tree shipped a new version the day before this was scoped |

One line worth changing defensively: bump `"zod": "^3.24.1"` → `"^3.25.32"` in `server/package.json`
so a future clean install can't drift below the real requirement.

### The design in one paragraph

Five nodes — `agent` (calls `streamPersonal`, relays tokens), `dispatchNonDestructive` (runs the 10
inline tools), `confirmGate` (the `deleteAllTasks` interrupt), `applyConfirmedTool`, `finalize`.
`MAX_TOOL_ROUND_TRIPS = 4` becomes an explicit state field plus a conditional edge — same value, same
semantics. Quota admission **stays outside the graph** at the route layer, because a 402 must remain
a plain JSON response rather than a stream event. Checkpointing uses `MongoDBSaver` with
`ttl: 3600` — deliberately matching the existing `STALE_PENDING_MS` — on a per-turn `thread_id`, with
its own small `MongoClient` rather than Mongoose's (their nested `mongodb` driver versions differ).

### The one design mistake that would cause real damage

**On resume, a LangGraph node re-runs from the top.** Any side effect before the `interrupt()` call
fires again. If `dispatchNonDestructive` and the confirmation gate were one node — the obvious first
design — then a round containing both `createTask` and `deleteAllTasks` would **re-create the task on
every resume.** Hence the split: `confirmGate` contains *nothing* but the `interrupt()` call. Write
the test for exactly this case: a round with both tool kinds, asserting the non-destructive side
effect happens exactly once across an interrupt + resume cycle.

### Correction to an earlier claim in this plan

I previously wrote that `pendingToolStore.ts:29`'s per-process `Map` blocks multi-instance deployment
and that the checkpointer fixes it. **That was overstated.** Tracing it properly: the DB record
(`AiConversation.toolCalls` via `findPendingToolCall`) is *already* the source of truth for the
confirm route, and the Map is load-bearing for exactly one field — `timezone` — which
`deleteAllTasks` doesn't use. A cross-instance confirm degrades to slightly worse date formatting in
the follow-up message. **Not broken; degraded.** The real benefit is replacing two overlapping
persistence mechanisms with one, and closing that cosmetic gap — a modest correctness and
maintainability win, not a scaling fix. Claim it accurately in the pitch.

**A genuine new capability, though:** checkpointing gives free mid-turn fault tolerance. Today a crash
between a tool executing and the follow-up Gemini round loses the turn entirely. With a checkpointer
it resumes from the last completed step. That didn't exist in any form before.

### Free win to take while you're in there

`streamPersonal.ts` has **zero retry logic** — a mid-chat Gemini 503 or 429 goes straight to an error
event, even though `withGeminiRetry` (`voiceCore/geminiRetry.ts`) already exists and is used by
`audioTranscriber`, `voiceCore/extract`, and `documentCore/extract`. Wrap the `agent` node's call in
it. Your own helper, not a LangGraph feature — but the rewrite is the natural moment.

### Sequencing — strangler fig, never broken mid-migration

**Phase 0** (no dependency yet): fix the `usage` overwrite at `service.ts:369`, de-duplicate the
`send()` SSE writer, add `AI_ORCHESTRATOR: z.enum(['legacy','langgraph']).default('legacy')` to
`env.ts`.
**Phase 1** (unreachable from any route): build `modules/ai/graph/` with its own tests. **Day-1 spike
first** — the one genuinely unverified piece is how an interrupt surfaces on the raw multi-mode
`.stream()` iterator; fall back to `streamEvents` v3 projections if it doesn't behave as expected.
**Phase 2**: `service.ts` keeps the identical `ask()` / `continueAfterConfirm()` signatures and
branches on the flag. `routes.ts` doesn't change at all. **Rollback is one env var.**
**Phase 3**: delete the legacy path and the flag after burn-in.

### Test impact — better than feared

**2 of 41 test files need edits**, and mostly in the arrange step, not the assertions:

| File | Impact |
|---|---|
| `toolRunner.test.ts` (900 lines — the largest) | **Untouched.** Zero coupling to the orchestration loop |
| `service.test.ts` | Most tests keep working unmodified because the `streamPersonal` mock still applies. One bulk-delete test rewrites to assert on graph state |
| `routes.test.ts` | Confirm-flow tests hand-seed `pendingToolStore`; that setup changes. **Assertions stay** — they're the SSE contract |
| The other 6 AI test files + 32 elsewhere | Untouched |

### The SSE adapter — highest-risk piece

The client parses raw `data: {type,...}` frames keyed on string literals, so the wire format must
survive byte-for-byte. Six of the seven event types are pure pass-throughs. The one piece of genuinely
new code: after draining the graph stream, the route must call `getState()` to distinguish "reached
END" (emit `done`) from "paused at `confirmGate`" (emit the deferred `tool_call` and stop).

**Do not "fix" the client error path as part of this.** Today an error event is sent and the stream
just ends — no trailing `done`. `queries/ai.ts:216` has a known bug where it doesn't `return` and
commits the broken draft anyway. That's a real bug worth fixing (§2 of `LAUNCH-PLAN.md`), but fixing
it *inside* this migration trades a characterised bug for an uncharacterised one. Keep the frame
shape identical; fix the client separately.

---

## 5. Observability & security (rubric #4 and #6)

Reviewers: *"Security and Observability: Near-Zero Across the Batch."* This is Kitto's biggest
scoring opportunity, because the audits already produced the content.

### Langfuse (~1 day)

`langfuse` + `langfuse-langchain` — the LangChain callback handler drops straight into the LangGraph
migration, so do it in the same week. Self-hostable via Docker, which pairs with rubric #5.

Trace: every LLM call with model, token counts, cost, latency, and the tool sequence per turn.

**Prerequisite:** `modules/ai/service.ts:370` does `usage = ev.usage` inside the round loop —
**overwriting instead of accumulating**, so a 5-round turn reports only the last round. That is a
**4.2× token under-report**. Fix it first or Langfuse will faithfully display the wrong number.

### The security chapter — write it from what the audits found

Structure it as *"what we found and what we did,"* which is far more credible than a checklist:

| Area | What to say |
|---|---|
| **AI data handling** | Documents include `medical`, `identity`, `tax`, `legal` types. Moved off the free-tier Gemini API (whose terms permit human review) to paid/Vertex, where prompts are not used for training. **This is the single highest-consequence fix in the project — say so.** |
| **Authentication** | Argon2id password hashing; JWT pinned to HS256; refresh-token rotation with **family revocation on reuse detection**; HMAC-signed OAuth state with timing-safe comparison. All pre-existing and genuinely well built. |
| **Authorization** | Every `/me/*` route scopes its Mongo query by the authenticated user id — audited across all routes, **no IDOR found**. |
| **Injection** | NoSQL injection blocked by Zod validation before any value reaches a Mongo filter. **Prompt injection identified as a live risk** and mitigated by confirmation-gating mutating tools + delimiting untrusted extracted text. |
| **SSRF** | The ICS feed fetcher takes a user-supplied URL. Protocol allowlist, private/CGNAT/link-local/metadata IP blocklist, all-DNS-answers checked, per-redirect re-vetting, size cap, timeout. Known residual: DNS-rebinding TOCTOU, documented in-code. |
| **Secrets & encryption** | Google OAuth refresh tokens stored AES-256-GCM encrypted. Bearer tokens redacted from logs (`pinoHttp` `redact`). |
| **Cost abuse** | Per-user atomic quota counters (guard in the `updateOne` filter, so the TOCTOU race is genuinely closed), rate limiting, a provider-level billing cap, and a spend circuit breaker. |
| **Privacy / GDPR** | In-app account deletion with a full cascade, and data export. |

**Say what you fixed during the project.** "We audited and found X, here is the fix" demonstrates
engineering judgment. A clean checklist demonstrates nothing.

---

## 6. Deployment (rubric #5) — ~3 days

Same work as `LAUNCH-PLAN.md` §2.2 items 1.3/1.4, so it counts twice.

| Item | Plan |
|---|---|
| **Docker** | Multi-stage Dockerfile for `server/`. Also compose Langfuse + Mongo for local dev — it makes the "we can deploy this" claim concrete. |
| **CI/CD** | GitHub Actions: `typecheck` ×2 → `lint` → `check:lang` → `server test` → `build` → Docker build. **Add two guards that catch automatic App Store rejections:** `Info.plist` must contain no `NSAppTransportSecurity`, and `AppDelegate.swift` no `NSSelectorFromString`. Both are *currently* in the failing state. |
| **Testing** | Backend: 513 tests already. Frontend: **zero** — add a 4-test Playwright smoke (signup → onboarding → create matter → dashboard; sign-in; document upload → review; delete account → sign-in fails). ~4h for the highest-value coverage available. |
| **Hosting** | Render (API) + MongoDB Atlas + Cloudflare R2 (documents) + Cloudflare Pages (static export). ~$17/mo at zero users. **One instance only** — `icsFeedWorker` and `googleSyncWorker` claim work non-atomically and would double-process. |
| **Object storage** | Documents currently `writeFile()` to container-local disk — **the first redeploy destroys them.** Migrating to R2 is both a rubric item and the #2 launch blocker. |

Fix before the demo, since both are visible: `npm run lint` fails with 11 errors (the real one is
`lib/ai/useVoiceRecorder.ts:113`, a use-before-declare **in the voice recorder**), and
`npm run check:lang` fails on a deliberate `left-0` that needs an `EXEMPT_FILES` entry — which means
`check:i18n` has never actually run.

---

## 7. Pitch video map (10 minutes)

Against the required 8-section structure. Times are a guide.

| § | Required | Kitto's answer | Time |
|---|---|---|---|
| 1 | **Project overview, one sentence** | *"Kitto turns the documents and sentences of everyday life admin into reminders that arrive before the deadline — in English and Arabic."* | 0:30 |
| 2 | **Problem / who / why** | Life admin is deadline-shaped and scattered across paper, email and memory. Missing one has a real consequence — a lapsed visa, an expired warranty, a registration fine. Existing to-do apps only store what you type; they never read the letter. Ground it in Egypt/MENA specifics. | 1:00 |
| 3 | **Proposed solution** | Voice → matters; document → extracted deadline with a citation; six life domains; the daily brief; reminders on the device. | 1:00 |
| 4 | **User workflow, step by step** | Speak or scan → extract → **review and confirm** (never silent) → filed by domain → reminder fires on the Lock Screen with Done/Snooze. **Demo this on a real device, not a simulator.** | 1:30 |
| 5 | **AI architecture** | Why AI is essential (§8 below); Gemini 2.5 Flash and why (§2); **LangGraph** for the conversational agent and why only that part (§4); **RAG over the user's documents** with vector store, chunking and embedding model named (§3); the 11 tools and which require confirmation. | 2:30 |
| 6 | **Technical architecture** | Next.js 16 static export + Capacitor 8 (one codebase → web + iOS + Android); Express + MongoDB; Gemini; Google Calendar + ICS; Docker/Render/Atlas/R2; **Langfuse**. | 1:30 |
| 7 | **MVP scope** | Done / demoed / phase 2. **Be honest here** — the completion audit is the source. Do not claim citations, reliable reminders, or Pro until they're built. | 1:00 |
| 8 | **Why AI is essential + 30-second summary** | §8 | 1:00 |

**Two slides most projects won't have — put them in:**
- **Arabic/RTL**, shown live. Not a bullet — flip the language mid-demo and show the layout mirror. Reviewers named this a competitive advantage.
- **Security & observability**, from §5. Reviewers said this is near-zero across the batch.

**Guidelines say:** don't read from the proposal, and focus on idea/workflow/AI design over code.

---

## 8. "Why is AI essential?" — the answer to rehearse

The trap is answering "because it's an AI course." The real answer is a capability argument:

> Kitto's input is **unstructured and human**: a sentence spoken while walking, and a photograph of a
> letter. Its output must be **structured and exact**: a date, an amount, a reference number, a
> domain, a lead time. Nothing but a language model bridges those two — a form would work, but a form
> is the thing users already refuse to fill in, which is why the deadlines get missed in the first
> place. AI is not a feature layered on a to-do app. **It is the input method.** Remove it and there
> is no product — only another app asking you to type in what you already forgot.

Then the honest qualifier, which is what separates a good pitch from a confident one:

> And because the model can be wrong, every extracted value carries the page it was read from, and
> anything below the confidence threshold asks the user instead of guessing. One wrong renewal date
> loses trust permanently — so the system is designed to say "I'm not sure" rather than to be
> impressive.

---

## 9. Three-week schedule

**The three-week plan does not survive the LangGraph scoping.** That migration came back at
**7.5–10 days**, not the 5 originally assumed. Three weeks of working days is 15. LangGraph + RAG
(5d) + infra and write-up (5d) is 17.5–20 days of work. Something has to give, and it is better to
decide that now than in week three.

### Option A — LangGraph + no RAG (3 weeks, recommended)

| Week | Work | Rubric |
|---|---|---|
| **0** (1 day) | `LAUNCH-PLAN.md` §1 Phase 0 + the `usage` accumulation fix | #6, prerequisite for #4 |
| **1–2** | LangGraph migration, strangler-fig, tests green at each step | #2 |
| **3** | Langfuse, Dockerfile, GitHub Actions, Playwright smoke, R2 migration, write up §2/§3/§5 | #1 #4 #5 #6 |
| **+3 days** | Record the pitch, rehearse §8 | all |

RAG is answered in writing with the §3 fallback — *"we deliberately don't use RAG for task context;
the corpus is small, per-user and structured, so retrieval is exact indexed queries rather than
approximate similarity."* The rubric item is **conditional** (*"If you're using RAG…"*), so this is a
complete answer, not a gap. **Cost:** `CitationChip` stays unbuilt, so the pitch cannot claim
provenance.

### Option B — RAG + no LangGraph (3 weeks)

Swap weeks 1–2 for RAG (5d) and keep the hand-rolled loop, justified in writing as a deliberate
choice: a bounded 4-round tool loop with server-side confirmation gating, atomic quota admission and
per-tool Zod validation. **Cost:** the agent-framework rubric item goes unanswered, and reviewers
called it out specifically — only 1 of 15 projects named one. **Gain:** citations get built, which is
the app's own stated #1 risk, and the demo gets materially stronger.

### Option C — both, four weeks

Only if the deadline allows it. Nothing is cut.

**Whichever you pick, never cut Phase 0.** It is one day, it is the security chapter, and reviewers
said security and observability are near-zero across the entire batch. It is the highest score per
hour available anywhere in this plan.

**If a week slips inside the option you chose, cut in this order:** the Playwright smoke, then the R2
migration, then the Docker compose for Langfuse (keep the Dockerfile).

---

## 10. What not to do

- **Don't rewrite the whole backend for the framework.** Only the conversational loop becomes a graph. Explaining *why* the single-shot calls stayed on the raw SDK is a better answer than uniformity.
- **Don't claim features that don't work.** Citations, reliable reminders, and Pro are all incomplete (`LAUNCH-PLAN.md` §2). A reviewer who finds one overstatement discounts everything else.
- **Don't build billing for the graduation.** It is Track B. A pitch slide can say the model is a free tier plus a subscription without a line of RevenueCat existing.
- **Don't de-emphasize Arabic.** `LAUNCH-PLAN.md` §4.5 argues against MENA as a paid-acquisition target — that is a *commercial* judgment about where subscribers are. For this rubric, Arabic/Egyptian localization is an explicitly named advantage. Lead with it.
- **Don't demo on the simulator.** The strongest thing you have is a reminder firing on a real Lock Screen with working Done/Snooze buttons. That is also the App Store 4.2 defense, so the recording is reusable.
