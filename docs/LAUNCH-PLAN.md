# Kitto — Launch Plan (Track B: commercial)

> Written 2026-08-04 from eight parallel audits of the repo at `a46ded4` (+ uncommitted motion refactor).
> Revised the same day after the graduation-project context surfaced.
>
> **This is Track B. Read [`GRADUATION-PLAN.md`](GRADUATION-PLAN.md) first — it runs first (~3 weeks).**
> Phases 0–2 below are shared between both tracks; Phases 3–5 are commercial-only and start after
> the graduation review.
>
> Supersedes the pricing section of `docs/business-model.md`; everything else in that document
> still holds and was independently re-verified here.
> Every claim carries a `file:line` or a source URL. Where the audits disagreed, the disagreement
> is stated rather than averaged.

## Scope correction (2026-08-04)

**Kitto is a life-admin reminder product, not a money product.** An earlier draft of §4 proposed a
savings ledger with price-increase detection and switch-now advice. That is a financial-advice
product — a different thing, with the regulatory exposure `business-model.md` §5 already flags
(TCPA one-to-one consent in the US, FCA authorisation in the UK) — and it is out of scope.

What survives, and why it is not the same thing: `docs/features.md` #3 already specifies that the
Document-to-Task Chain extracts *"dates, **amounts**, policy number, parties"* and creates
`Pay $[amount] by [date]`. A reminder that carries the amount it is about is still a reminder.
**Kitto reads a number off a document so the reminder is specific. It does not compare prices,
recommend switching, track spending, or touch money.**

---

## 0. The situation in five sentences

The engineering is better than the product's readiness. Auth, sessions, ICS feeds, the document
viewer, categorize, and the account surface are genuinely well built and well tested (513 backend
tests, 41 files, zero skipped). But **you cannot charge anyone** (seven hardcoded-tier sites),
**you cannot deploy** (no Dockerfile, no CI, `.env.production` → `api.example.com`), **you cannot
submit to the App Store** (free Apple Personal Team; two automatic-rejection items live in the
working tree), and **a user who forgets their password is permanently locked out** (both endpoints
built, no UI). The single most urgent item is not any of those: it is that user passports and
medical records are being sent to the **free-tier Gemini API**, whose terms permit human review and
product improvement.

The strategic problem is separate and harder. The product's promise — *"we watch this so you don't
have to think about it"* — is an instruction to stop opening the app, and productivity has the worst
annual first-renewal rate of any App Store category at **23%**
([RevenueCat 2026](https://www.revenuecat.com/blog/growth/average-subscription-renewal-rates-by-app-category/)).
Everything in §4 exists to answer that.

---

## 1. Phase 0 — before the server gets a public URL

Nothing here is optional and none of it is more than a day's work.

| # | Task | File | Why | Effort |
|---|---|---|---|---|
| 0.1 | **Move Gemini off the free tier** — enable billing on the API key, or switch to Vertex | `server/src/modules/ai/provider/geminiClient.ts:27` | `new GoogleGenAI({ apiKey })` with no `vertexai` flag. Free-tier terms permit Google to use prompts for product improvement and human review. What's being sent inline base64: full PDFs of documents whose `DOCUMENT_TYPES` include `medical`, `insurance`, `identity`, `tax`, `legal` (`models/ScannedDocument.ts:47-59`), plus raw voice audio. **Highest-consequence item in the repo.** | 1h |
| 0.2 | **Hard billing cap on the Gemini/GCP project** | console only | The only backstop that survives a bug in your own code. Converts every cost hole below from "bankruptcy" to "the API stops answering." | 10min |
| 0.3 | **Redact the `Authorization` header from logs** | `server/src/app.ts:60` | `pinoHttp` configured with **no `redact` option**; pino-http's default `req` serializer includes `req.headers`, and `requireAuth` reads the token from `req.headers.authorization`. **Every authenticated request logs a live Bearer JWT at `info` level.** Fix: `redact: ['req.headers.authorization', 'req.headers.cookie']` | 5min |
| 0.4 | **Quota-gate `POST /me/voice-notes`** | `server/src/routes/me.voiceNotes.ts:~114` | Has `aiVoiceLimiter` (12/min) but zero calls to `admitWithinQuota` (verified by grep). 17,280 requests/day → **$104–$1,504/day from one account**, × N accounts (signup issues a session before email verification, and `emailVerifiedAt` gates nothing). | 3h |
| 0.5 | **Gate and batch `refineWithAi`** | `server/src/modules/reminders/planReminders.ts:31`, `modules/integrations/ics/syncFeed.ts:166,187` | Fire-and-forget ungated Gemini call, fired **per calendar event**. One ICS feed with 300 future events = 300 ungated calls on first sync, and again on every date change. **Worse than 0.4 because it needs no malice** — a normal user with a busy calendar triggers it. | 5h |
| 0.6 | Quota-gate clarification custom answers | `server/src/routes/me.clarifications.ts:158` | Post-hoc `recordUsage` only; no pre-call admission, no rate limiter. | 2h |
| 0.7 | Rate-limit the ICS feed endpoints | `server/src/routes/me.icsFeeds.ts:42,113` | The only network-calling routes with no limiter. Each call = up to 4 redirect hops × 15s to an attacker-chosen URL. Unthrottled outbound request cannon from your server's IP. | 1h |
| 0.8 | Fix the `usage` overwrite | `server/src/modules/ai/service.ts:370` | `usage = ev.usage` inside the round loop **overwrites instead of accumulating** — a 5-round turn reports only the last round. This is the **4.2× token under-report**. Every cost number is wrong until this is fixed. | 1h |

**Also in Phase 0, zero code:** start the Apple Paid Applications Agreement and banking/tax forms.
`docs/business-model.md` flags Apple payouts to Egyptian bank accounts as unverified. This is the
only item on the entire plan with external latency you cannot compress — it goes on day 1 or it
becomes the critical path later.

---

## 2. Phase 1 — correctness and legal (≈2 weeks)

### 2.1 The three things that break the hero loop

A new user today can sign up, speak a sentence, and get matters. They cannot get citations, they
won't see the matters appear, and the reminder may never fire.

| Break | Evidence | Fix |
|---|---|---|
| **Citations do not exist** | No file matches `*Citation*` anywhere in `app components lib queries hooks`. `docs/primitives.md:30,350` marks `CitationChip` "✅ built" — it is a non-interactive `<span>` in `components/chat/AssistantText.tsx:98` that parses two kinds, has no `onClick`, no `document` kind, no navigation. Extraction stores only `sourcePage` — no bbox, no verbatim text. `ScannedDocument.rawExtractedText` is declared and never written. `toolRunner.ts:397-411` never sets `sourceVoiceNoteId`. | Build the real primitive. `AGENTS.md` calls this priority #1: *"if a surface renders an AI-derived value without provenance, it is NOT done."* |
| **The voice panel discards its own results** | `components/voice/VoiceIsland.tsx:180-188` handles 3 of 6 SSE events; `tool_call`/`tool_result` are dropped and there is no `useQueryClient` in the file. Say "mark my dentist appointment done" → server completes it, list stays stale. Also means `deleteAllTasks` can never be confirmed from voice — it silently expires server-side. | Route voice through `queries/ai.ts`'s `useAskAi()` instead of driving `lib/ai/stream.ts` directly. This also fixes an `AGENTS.md` module-boundary violation. |
| **Reminders only sync when the app is foregrounded** | `lib/notifications/syncReminders.ts` has **no caller on data change** — only mount, `visibilitychange`, and post-notification-action. Create a matter → background the app → never reopen → the OS holds no schedule and nothing fires. | Call `syncReminders()` from the existing task-mutation invalidation in `queries/tasks.ts`. ~2–3h. |

### 2.2 Launch blockers

| # | Task | Evidence | Effort |
|---|---|---|---|
| 1.1 | **Password reset UI** | Both endpoints built and tested (`auth.password.ts:70,93`). Grep for "forgot" in the frontend returns **zero**. Users are currently unrecoverable. | 3–4h |
| 1.2 | **Deep-link router for `kitto://auth/*`** | Scheme registered (`Info.plist:30-33`); the only `appUrlOpen` listener is Google-only (`GoogleAccountSheet.tsx:95`). The emailed verification link opens the app and **nothing happens**. | 2h |
| 1.3 | **Object storage (R2) for documents and voice** | `lib/documentScanStorage.ts:23` and `voiceNoteStorage.ts:23` `writeFile()` to `process.cwd()/uploads/`. **First redeploy destroys every user document.** The two files are byte-identical 51-line `put/get/remove` interfaces — the seam already exists. | 8h |
| 1.4 | **Deployment**: Dockerfile, host, real API URL, backups + one restore drill | Nothing exists. `.env.production` = `https://api.example.com`. | 8h |
| 1.5 | **Privacy policy, ToS, support URL** | Zero legal artifacts in the repo. Apple 5.1.1(i) blocks listing creation without a privacy URL; Google OAuth verification needs one too. The static export can host its own — `app/privacy/page.tsx` → `out/privacy/index.html` → Cloudflare Pages. | 1–2 days |
| 1.6 | **Dashboard doesn't check `isError`** | `app/dashboard/page.tsx:74,122,130` gate on `!isPending` only. In TanStack v5, `isPending` is `false` on error — so a failed fetch renders **"Rest, you're caught up"** to a user with dozens of open matters, no retry, no error. The one screen in the app that violates the pattern `matters/page.tsx` and `documents/page.tsx` both follow correctly. | 1h |
| 1.7 | **In-stream SSE error commits a broken message** | `queries/ai.ts:214-232` (and `380-400`) sets `status:'error'` but doesn't `return`, so the partial/empty draft is committed to visible history and `failedQuestion` is never set — no retry possible. Server never sends a trailing `done` on error (`ai/routes.ts:151-166`), so this fires on any quota hit or tool exception. | 30min |
| 1.8 | **Account deletion leaves a live Google credential** | `server/src/routes/me.ts:188-203` omits `Integration` (holds a working, decryptable OAuth refresh token), `IcsFeed`, `TranslationUsageCounter`. `disconnectGoogle()` already exists and revokes properly — `DELETE /me` just never calls it. GDPR Art. 17 failure. | 30min |
| 1.9 | **Fix the two automatic App Store rejections** | `Info.plist:42` `NSAllowsArbitraryLoads=true` — and `scripts/patch-ios-plist.sh:100` `exit 0`s **before** the ATS block, so the production path never removes it. Plus three private-API calls in `AppDelegate.swift:27,72,88` (the script's own comment says "revert before submitting"). Add both as CI guards. | 2h |
| 1.10 | **Un-gitignore `ios/`** | `.gitignore:13-14`; `git ls-files ios` returns **0**. `DEVELOPMENT_TEAM`, `MARKETING_VERSION`, deployment target, orientations exist on one laptop only. Any regenerate silently reverts them. | 30min |
| 1.11 | **Exclude dev routes from the production build** | `out/` contains `styleguide/`, `zz-preview-dashboard/`, `zz-preview-onboarding/`, `zz-preview-viewer/`, `health/`, `zz-test.pdf`. `capacitor.config.ts` sets `webDir: 'out'` — all of it ships into the binary. `health/` exposes the backend URL, DB state, and dev instructions. Guideline 2.2 risk. | 2h |
| 1.12 | **`npm run lint` fails: 11 errors** | The real one is `lib/ai/useVoiceRecorder.ts:113` — *"Cannot access variable before it is declared"* (`stopInternal` used at 113, declared at 163), in the hero voice loop; React Compiler bails out of optimizing the hook entirely. Rest are `set-state-in-effect`. | 3h |
| 1.13 | **`npm run check:lang` fails** | `check:rtl` trips on `components/scan/viewer/ZoomPanSurface.tsx:50` — where `left-0` is **deliberately correct** (the pan transform is physical). Add to `EXEMPT_FILES` per the `PhoneFrame.tsx` precedent. Because the script is `check:rtl && check:i18n`, **`check:i18n` has never run** — catalogue parity is currently unverified. | 30min |
| 1.14 | **Two facades that are small lies** | `app/profile/page.tsx:209` — the "Reminders" toggle persists `notifications.push` and **no reminder code reads it**; turning it off does not stop reminders. `DeleteAccountSheet.tsx:19` says matters are "recoverable from Trash for 30 days" — there is **no TTL index**; only a manual purge route. Both undermine a product selling trust. | 2h |
| 1.15 | **Route guards missing on 2 of 4 tabs** | `/matters` and `/documents` have no `layout.tsx` and no guard. Signed-out users see the shell with failing queries instead of a redirect. | 1h |
| 1.16 | **`RESEND_API_KEY` unset → email no-ops *and logs the full body*** | `server/src/lib/email.ts:14-23`. If production ever boots without the key, verification codes and reset tokens land in plaintext logs. | 30min |

### 2.3 Prompt injection — decide before Phase 3

`contextBuilder.ts:141` interpolates raw `task.notes` — AI-generated prose from whatever was on a
scanned page — directly into a prompt that always has function-calling attached. And
`requiresConfirmation()` (`toolRunner.ts:239-241`) gates **only `deleteAllTasks`**; `deleteTask`,
`updateTask`, and `createTask` execute inline.

A booby-trapped PDF mailed to a target could mutate their matters on their next chat turn. Fix by
requiring confirmation on all mutating tools, or by delimiting untrusted extracted text as
data-not-instructions. Note `docs/overview.md:22` claims every state-changing call is user-confirmed —
that claim is false and should be corrected either way.

### 2.4 Free wins — already-paid-for work, 1–4 hours each

| Win | What exists | Effort |
|---|---|---|
| **Turn on Google Calendar** | The entire OAuth + refresh + AES-256-GCM token storage + sync worker + UI is built, tested, and **dark**. Needs a Google Cloud client and 4 env vars (absent from `server/.env.example`). Best built-work-to-shipped-value ratio in the repo. | 1–2h |
| Render the rest of the digest | `themes`, `duplicates`, `busiestDay`, `estimatedMinutesToday` are computed, cached, shipped to the client on every dashboard load — then discarded at `DashboardView.tsx:131`. | 3–4h |
| Expose `estimate-backlog` / `translate` | Both fully built with their own quota modules. **Zero frontend callers.** `translate` directly supports the shipped "Kitto answers in your language" claim. | 2–3h each |
| Missing i18n error codes | `quota_exceeded` and `ai_not_configured` are absent from `errors.json` byCode → Arabic users hit a limit and are shown a generic error, never learning a limit exists. | 1h |

### 2.5 The dead voice pipeline — a decision, not a bug

`server/src/routes/me.voiceNotes.ts` (5 endpoints), `voiceCore/{contract,extract,gate,dedupe,persist}`,
`voiceNoteStorage`, `voiceNoteNotification` — confidence buckets, three-lane review gating, idempotent
upsert, clarify-question generation, all tested — have **zero frontend callers**. The app runs a
shortcut path instead (`/ai/voice/transcribe` → `/ai/ask` → `createTask`, inline, no confirmation,
no confidence gating). Meanwhile `voiceNoteTranscriber` **runs in production polling an empty
collection every 2 seconds** (`index.ts:21`), and `contextBuilder.ts:103` grounds chat on
`VoiceNote.find({status:'ready'})` — permanently empty, so `[voice:id]` citations can never resolve.

Either wire the real pipeline (it is the one with the trust machinery the citation work needs) or
delete it and the worker. Do not leave both. **Recommendation: wire it** — it is a prerequisite for
§4's provenance work and it is already written and tested.

---

## 3. Phase 2 — the money plumbing (≈70 engineering hours)

### 3.1 Rail: RevenueCat

`npm i @revenuecat/purchases-capacitor`. 3–5 days vs 12–20 building StoreKit + Play Billing directly.
$0 until $2,500/mo tracked revenue, then 1%. Store-agnostic entitlements mean adding web billing
later is a config change, not a re-architecture.

Stripe-web-only is rejected: Stripe does not operate in Egypt, the post-*Epic* US link-out carve-out
does not extend to other storefronts, and an out-of-app browser hop destroys Day-0 conversion.

> **Verify the current App Review link-out rules immediately before submission.** They changed at
> least twice during 2025. Do not build the revenue model on them.

**The integration bug to pre-empt:** call `Purchases.logIn(mongoUserId)` at session establish and
`Purchases.logOut()` on sign-out (`lib/auth/sessionStore.ts:130,149`). Leave the anonymous app-user-id
in place and every webhook arrives with an ID matching no user — purchases silently fail to grant.

### 3.2 Entitlements

**All seven hardcoded-tier sites** (`docs/business-model.md` says four):

`modules/ai/routes.ts:28` · `me.tasks.ts:246,294,339,454` · `me.documentScans.ts:110` · `dailyDigestProse.ts:113`

**Live bug waiting for your first customer:** `me.documentScans.ts:162` already reads the *real* tier
to render the quota meter while `:110` hardcodes `'free'` for the gate — **a paying user would see a
200-scan meter and be blocked at 20.**

New `server/src/modules/billing/resolveTier.ts` (not in `modules/ai/`, which would invert the
dependency direction). Status → entitlement mapping is the whole design: `grace` **grants** (a failed
card must not lock someone out of their own documents mid-retry), `on_hold` **revokes** (Play's retry
is already exhausted), `canceled` grants until `renewsAt`.

**Do not put the tier in the JWT** — a 15-minute token means a purchase grants nothing until rotation
and a refund keeps granting for 15 minutes.

Webhook at `POST /webhooks/revenuecat` with a `BillingEvent` model for idempotency (insert-first,
treat duplicate-key as "already seen") and an `event_timestamp_ms` conditional write for out-of-order
delivery. **A nightly reconciliation sweep is not optional** — webhooks get lost, and a lost
`EXPIRATION` grants Plus forever.

### 3.3 Price

| | Recommendation |
|---|---|
| Monthly | **$8.99** (deliberately poor value; both audits converge here) |
| Annual | **$79** — see the disagreement below |
| Family (up to 5) | **$119/yr**, Phase 4 |
| Trial | **14 days, card required** (StoreKit always attaches one — take the 48.8% vs 18.2% conversion benefit), gated on `emailVerifiedAt` |
| Paywall | **Hard**, with a low-emphasis "Continue with the free plan" link |

**The disagreement, stated honestly.** Market research argues **$59.99/yr**, anchoring to Trustworthy
(~$120/yr) and Everplans ($99.99/yr) and undercutting by half. The margin model argues **$79/yr**,
because at $59 the net is $4.18/mo against a post-fix engaged COGS of $1.79 — **57% gross margin,
below the 70% floor before a single heavy user appears.**

**Recommendation: $79.** The anchoring argument survives at $79 (still under Everplans), and market
research's own data cuts this way — Year-1 realized LTV is **$62.19 for high-priced apps vs $10.69
for low-priced**, a 5.8× spread. Underpricing is the more common error. Revisit only if trial→paid
comes in under ~30%.

**Hard paywall is the highest-leverage single decision available.** 10.7% vs 2.1% D35 conversion,
$3.09 vs $0.38 D60 revenue per install, and Year-1 retention is statistically identical (27% vs 28%)
— there is no retention penalty. It is also the only structure under which paid acquisition isn't
automatically loss-making: Apple Search Ads goes from **~$112 to ~$29 per paying subscriber** against
a category Y1 LTV of $24.95.

### 3.4 Margin

Levers 1–7 take engaged COGS from **$3.26 → $1.79/user/month**:

| # | Lever | $ saved/user/mo | Effort |
|---|---|---|---|
| 1 | Lean-project `queryTasks` — 50 full Mongoose docs = 13,088 tokens, **re-sent on every tool round** | **$0.60** | 3h |
| 2 | `thinkingBudget: 0` on the 9 uncapped call sites | $0.35 | 2h |
| 3 | `MAX_TOOL_ROUND_TRIPS` 4→3 + early exit | $0.25 | 2h |
| 4 | Implicit context caching (hoist the stable ~4,500-token prefix) | $0.18 | 4h |
| 5 | Route classification work to flash-lite | $0.08 | 3h |
| 6 | `maxOutputTokens` (appears **zero times** in the codebase) | $0.02 + bounds the tail | 1h |
| 7 | Client image downscale to 1024px (`Camera.getPhoto({ width: 1024 })`) | $0.02 | 1h |

Gross margin at $8.99/mo: **77%**. At $79/yr: **68%**. Blended 60/40: **72%** ✓. Every account stays
profitable even at the fair-use ceiling (150 chat turns / 40 scans / 100 voice notes per month).

**Two corrections to prior assumptions, both in your favour:**
- **All three usage counters are already atomic** — the guard is in the `updateOne` filter, not a
  read-then-write. That TOCTOU race is genuinely closed. Do *not* "upgrade" them to `findOneAndUpdate`.
- **On-device OCR is not a cost lever.** After lever 7 it saves ~$0.002/user/month for 5 days of
  two-platform native work, and it would *hurt* extraction quality by discarding the layout that
  `documentCore/extract.ts` relies on to read policy schedules and renewal boxes. If you build it,
  build it as a *privacy* claim (§4.3), not a COGS play.

### 3.5 Free tier

Free = **a document vault with a calendar**: manual matters, rules-based reminders, calendar import,
20 stored documents, export, date-bucketed digest. COGS ≈ **$0.0006/user/month**.

The strongest evidence this works is already in the code: `buildDailyDigest` falls back to
`neutralHeadline(computed.counts)` when prose is unavailable (`modules/tasks/dailyDigest.ts:380`) and
is **tested that way** (`dailyDigest.test.ts:509,563`). The home screen already works with AI off.

~14 hours makes it feel intentional rather than broken: manual document titling when extraction is
off (6h — without it the free tier's one real feature looks broken), a Mongo regex search fallback
(4h), and hiding the AI affordances (4h). That is also what makes a hard paywall defensible under
guideline 3.1.1 — a real free product behind the wall, not a demo.

### 3.6 Degradation, not a wall

`getQuotaStatus` already returns `used`/`limit`/`remaining`, and the 402 body already carries
`{kind, tier, limit, used, resetAt}`. Five rungs: warn at 80% → cheaper model (the seam exists at
`streamPersonal.ts:412`) → **queue over quota** (accept the upload, store the bytes, defer the
reading — this is how "your documents are safe here" survives the cap) → top-up → hard stop behind a
circuit breaker.

Today a paying user who hits a cap gets `errors.generic` ("Something went wrong") with no upgrade
path anywhere. Raise a `QuotaSheet` from `lib/api/client.ts` on any 402. A toast is the wrong surface
for a paywall.

---

## 4. Phase 3 — the wedge (≈20 days for the first two)

### 4.1 The unlock

**The extraction pipeline reads structure and stores prose.** `docs/ai-stories.md` Table 1 specifies
`policy_number`, `expiry_date`, `amount_due`, `premium_amount`, `warranty_expiry`, `refill_date` per
document type — **implemented nowhere**. `documentCore/extract.ts` turns *"Electricity bill for
$142.37, account 88213-4471, due July 30"* into a free-text `notes` field. The numbers are read and
thrown away.

Adding a `facts` block (`amount`, `currency`, `referenceNumber`, `expiresAt`, `autoRenews`,
`renewalTerm`, `cancelByAt` — each `{ value, confidence, sourcePage }`, all `.nullish()` so a
partial answer never fails the parse) is ~200 lines and unblocks everything below.

**Explicitly not in this schema:** `previousAmount`, or anything else that exists to detect a price
increase. Those fields only serve switching advice, which is out of scope per the header. The schema
stores what the document *says*, so a reminder can be specific and cited. It does not store what the
document implies about whether the user is being overcharged.

### 4.2 The features

| # | Feature | Effort | The argument |
|---|---|---|---|
| **1** | **The specific reminder** — structured facts, so a reminder reads *"Home insurance renews Thursday · £612 · policy 44821-B · read from p.2"* instead of *"Home insurance"* | 12d | Todoist and Apple Reminders never see the document, so the date, the amount, and the policy number can only ever be things the user typed in themselves. ChatGPT can read one pasted PDF but has no durable per-user corpus and no way to reach you on the day it matters. This is not a money feature — it is a **reminder that knows what it is about**, and every value on it is traceable to a page. |
| **2** | **The brief that arrives while the app is closed** — 07:20 local notification carrying one consequential fact | 8d | Directly attacks the 23% renewal rate. Renewal dates are known in advance, so the server can precompute the next N mornings and hand them to the device alongside reminders — **no push infrastructure, no cron needed**. `syncReminders.ts` already cancels-and-re-arms deterministically on every `visibilitychange`. If nothing is consequential tomorrow, **no notification fires.** |
| **3** | **Expiry Wall** — passport/visa/licence validity, plus the *derived* deadline (the 6-month passport-validity rule nobody tells you) | 9d after #1 | Needs three things stacked: reading an identity document, knowing the real-world lead time (already in `leadTime.ts`), and applying a rule the document never states. Apple Reminders has none of them. Expiry gets the strictest trust handling: below high confidence it goes to `holdForClarification` (which already exists and does exactly the right thing) rather than to a reminder. |
| **4** | **Forwarding address** (`you@in.kitto.app`) | 11d | Life admin arrives by email, not by voice. `EXTERNAL_SOURCES` in `models/Task.ts` **already contains `'email_forward'`** — the slot is reserved and unimplemented. Cloudflare Email Routing is free and unlimited inbound. Attachments drop straight into the existing `documentScanWorker`. Treat forwarded content as untrusted: never allowed to trigger a destructive tool. |

**Build 1 + 2 first.** ~20 days, and together they are the answer to *"why is this $8.99 when
Todoist is $5?"* — **"it read six of my documents and it reminds me with the actual dates and
reference numbers on them, before the deadline, and shows me the page"** is an answer; *"it has
voice too"* is not.

### 4.3 Two risks to test before building

- **Cold start.** A user with two documents has two reminders and no sense that the app is doing
  anything. Test it with the 5–10 concierge setups `docs/business-model.md` §5 already proposes —
  extract by hand from real people's documents. The question to answer is **"how many deadlines did
  we surface that this person did not already have written down somewhere?"** If the answer is
  routinely zero or one, the premise is wrong and you learned it for zero code.
- **"Will people photograph a passport into your app?"** Unanswerable from the code, and much worse
  while documents sit on local disk (Phase 1.3 fixes that). Ask 15 people before writing a line. If
  they hesitate, the answer is on-device validity extraction — store the date, discard the image —
  which is a different and smaller build, and the one legitimate reason to do on-device OCR.

### 4.4 Positioning: stop leading with AI

- 39% of consumers trust brands **less** for heavy AI use, up from 20% a year earlier; **24% have
  already cancelled a subscription over AI data handling**
  ([Usercentrics 2026](https://usercentrics.com/resources/state-of-digital-trust-report-2026/), 11k consumers).
- 50% of US smartphone owners won't pay extra for AI features, up from 45%.
- The only AI angle with a **measured** price premium is *transparency about AI use: +7%*.
- Loss framing outperforms gain framing in A/B tests (+14–18% on conversion steps). The large-scale
  proof point usually cited is Rocket Money (4.1M paying members on "cancel two subscriptions and
  it's paid for itself") — but note that is a **money app**, and Kitto is not. Borrow the *framing*,
  not the product.

For Kitto the loss is a **missed deadline and its consequence**, not an overpayment: a lapsed visa,
an expired warranty you could have claimed on, a registration fine, an insurance gap. Rewrite the
App Store subtitle and first paywall screen around that —
*"Never miss a renewal again"* / *"The deadline nobody reminds you about"* — and put a
plain-language data-handling promise above the fold. AI is the mechanism, not the pitch.

### 4.5 Where to sell

> **This section applies to Track B (commercial) only, and it is the one place the two tracks
> genuinely conflict.** The graduation reviewers state that *"supporting Arabic and targeting the
> Egyptian market can give your project a strong competitive advantage… clearly highlight them in
> your pitch."* For Track A, Arabic/Egyptian localization is a **scoring advantage to lead with**.
> The analysis below is about where *paying subscribers* are, which is a different question.
> Both can be true: lead the pitch with Arabic/RTL, and if you later commercialize, aim paid
> acquisition elsewhere. Nothing in the product changes either way — this is a marketing decision,
> not a build decision.

**Keep Arabic/RTL. If and when you spend money on acquisition, aim it at North America and Western
Europe.**

The MENA *consumer subscription* thesis does not survive contact with the numbers:

- UAE is **77.8% Android** ([StatCounter, Jul 2026](https://gs.statcounter.com/os-market-share/mobile/united-arab-emirates)); Play involuntary billing failures cause 31% of cancellations vs 14% on iOS.
- **MEA is the only region on Earth with negative subscription revenue growth: −9.7% YoY** (LatAm grew 17.2%).
- UAE expats are ~70% South Asian — **Indian 38.5%, Pakistani 16.7%, Bangladeshi 7.4%, Filipino 6.9%**. The highest-value localizations for that segment are Hindi/Urdu/Malayalam/Tagalog, not Arabic. Arabic serves GCC nationals, who have the *least* renewal anxiety because they hold no residence visa.
- **The UAE government app already sends free renewal reminders** for passport, visa and Emirates ID.
- Proziyo already ships the B2B version (15 document types, OCR expiry extraction, 90/60/30/14/7/1-day alerts).

The synthesis neither audit made explicitly: **the expat wedge and the high-ARPU market are not in
conflict.** Immigrants in the US, UK, Canada and the EU have green-card, visa, and residency renewals
with identical stakes, in markets with 2.0–2.8% D35 conversion and $25–32 Y1 LTV. Arabic/RTL stays as
product depth and a credible differentiator versus US-built competitors — it just isn't the
acquisition target.

---

## 5. Phase 4 — distribution, and the hedge

### 5.1 Ranked channels

| # | Channel | $/paying user | Time | Note |
|---|---|---|---|---|
| 1 | **ASO** | $0 | 4–12wk | ~65% of App Store downloads come from search. Long-tails are winnable. |
| 2 | **Apple featuring nomination** | $0 | ≤30d | One submission, 3 weeks–3 months pre-launch. Free. |
| 3 | **Partnerships** (brokers, relocation, expat services) | rev-share | 2–6mo | Insurance referrals convert ~4× other lead sources. No app-specific case study — unproven. |
| 4 | **Reddit** | $0 | 1–4wk | **61% of relevant subreddits ban self-promo.** r/SideProject explicitly allows it. r/personalfinance and r/productivity both ban it. |
| 5 | TikTok/Reels organic | $0, but a full-time job | 8–16wk | Enormous variance: 475M views → $60k MRR in one case; 500K views → 40 installs in another. |
| 6 | **Apple Search Ads** | **$29 w/ hard paywall**, $112 freemium | days | Productivity CPI $3.13. **Only viable behind a hard paywall.** |
| 10 | Content/SEO | effectively infinite in year 1 | 9–18mo | 48% of Google queries now trigger AI Overviews; organic CTR drops 34–61%. **Dead for a new site.** |

Product Hunt is not a payer channel in 2026 — median ~115 signups over 7 days, and it amplifies an
audience you already have rather than creating one.

### 5.2 The honest downside

**82.7% of subscription apps never reach $1k/month within two years. 95.4% never reach $10k.**
Median monthly revenue one year post-launch: **~$72**. Top-vs-bottom quartile gap is **400×**, up from
200× in 2024. ~15,000 new subscription apps launch **per month**, and pre-2020 apps still hold 69% of
all subscription revenue. ([RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps), 115k+ apps)

This is a lottery-shaped distribution, not a work-harder-earn-more market.

And the closest comparables are dead: **Yohana** (Panasonic-backed family concierge) shut down
Sept 2025. **Milo** (AI family OS, funded personally by Sam Altman, 3 rebuilds over 6 years) shut down
— the founder's own verdict was that the technology is too early to be reliable. **Everplans** sold
twice in 3 years, ending at a funeral-home lead-gen firm. **Trustworthy** has been silent since its
2022 Series A.

### 5.3 The hedge worth pricing: insurance brokers

Brokers already pay **$100–250/user/month** for renewal tooling, with **14–90 day** SMB sales cycles,
because retaining one commercial client recovers $12k–40k in premium. **Ten seats at $150/month is
$18,000 ARR — more than 82.7% of consumer subscription apps ever reach.**

The catch is real: it means building for the broker's workflow and integrating with Applied Epic /
Vertafore AMS360 / EZLynx. That is close to a different product, not a repackaging.

**Run 10 broker conversations in parallel with the consumer launch.** It costs calendar time only.
You are not committing to the pivot; you are pricing the option. The honest framing: *the consumer
app is the lottery ticket; the broker product is the job.*

The other B2B paths are worse — relocation/mobility is entrenched with SOC 2 procurement, HR benefits
marketplaces are months-long BD, GCC PRO services is already served by Proziyo, and family offices
are not a credible buyer for a solo founder.

---

## 6. Observability — you cannot run a paid product blind

Today: pino to stdout, `pino-http` request logs, and `GET /health`. That is all. **No client crash
reporting, no `app/error.tsx` or `global-error.tsx`, no React error boundary anywhere, no alerting,
no analytics.**

| Need | Tool | Cost |
|---|---|---|
| Client + server errors | Sentry | free to 5k errors/mo; $26/mo Team |
| Uptime on `/health` | UptimeRobot | free |
| Product analytics | PostHog (plain `posthog-js`, EU cloud, works in a static export + WebView) | free to 1M events/mo |
| Gemini spend | GCP budget alert + hard cap | free — **do this today** |

**The alerts that actually matter here** (not CPU graphs): Gemini daily spend; **the reminder worker
stopped** (`reminderWorker.ts` polls every 30s — emit a heartbeat and alert on a 5-minute gap; if it
dies silently every user's reminders stop and nobody tells you); scans/voice notes stuck `pending`
past 10 minutes; extraction failure rate >10% (`env.ts:53-58` documents a past incident where a
non-existent model id made every extraction silently 404); payment webhook failures.

**Instrument the hero loop before spending a dollar on acquisition:** `voice_record_started` →
`_completed` → `upload_succeeded` → `transcribe_succeeded` → `review_shown` → `review_confirmed` →
`matter_created_from_voice`. Plus `first_matter_created` (the activation metric) and
`reminder_action_tapped` — if nobody taps, the product isn't working regardless of what retention says.

---

## 7. Testing

**Zero frontend tests exist** — no runner, no config, no `npm test` script, 0 test files under `app/`,
`components/`, `lib/`, `queries/`, `hooks/`. The backend has 513 tests across 41 files with none
skipped, and covers the genuinely hard logic (`voiceCore/{extract,gate,dedupe}`, ICS parsing and time
resolution, `tokenCipher`, `quota`, `toolRunner`).

Highest value per hour:

1. **Playwright smoke, 4 tests, ~4h** — signup → onboarding → create matter → appears on dashboard; sign-in; upload document → review sheet; delete account → sign-in fails.
2. **A CI guard that `Info.plist` has no `NSAppTransportSecurity` and `AppDelegate.swift` has no `NSSelectorFromString`, ~1h** — worth more than any unit test, because both are automatic rejections and both are *currently* in the failing state.
3. `npm run check:lang` in CI (already written, never enforced).
4. Regression tests for the voice-note quota and the account-deletion cascade — write them before the fixes so they fail first.

Skip broad component unit tests. With one developer and a heavily animated UI, PostHog session replay
plus the Playwright smoke will find more real bugs per hour.

**Manual QA on a real device** (not the simulator) — the five that matter most: voice recording
interrupted by a call / in Low Power Mode; native camera scan; **a reminder firing with the app fully
closed, and Done/Snooze tapped from the Lock Screen**; kill the app for 3 days and confirm reminders
re-sync; account deletion end-to-end (Apple reviewers test this specifically).

`docs/manual-test-categorize.md` and `manual-test-uncertainty.md` are current and good.
`docs/voice-capture-manual-qa.md` self-identifies as half-stale — extract the OS-level audio section
and delete the rest. Nothing exists for scanning, onboarding, auth deep-links, deletion, or offline.

---

## 8. Kill list — scope is a budget

**Delete now:**

1. **The contradictory brand canon.** `AGENTS.md:26` cites `docs/new-direction.md` as "source of truth" — that file describes a marble king, crimson, **no emoji**, "he does not celebrate." `AGENTS.md` itself mandates a coral soft-planner with a ghost mascot and calls emoji chips "the signature mark of the system." `principles.md` contains both plus the retired panda. **Three mutually exclusive identities, all cited as authoritative** — a tax on every design decision. Delete `new-direction.md` and `stack.md`; cut the marble/crimson sections of `principles.md`.
2. **Repo ballast:** `Tiimo ios Feb 2026/` (234 entries of a competitor's screenshots), `king.png` (2.9MB), `ui.png` (1.4MB), `Project Improvement Notes copy.pdf` (byte-identical duplicate).
3. The three `zz-preview-*` routes (marked throwaway in their own source).

**Cut from the roadmap:**

4. `smart-reminder-conflict-spec.md` Phases 3–5 — batching matters at 40 reminders/day, not 4.
5. Two of the three matter-reorganizing AI surfaces (`summarize`, `estimate-backlog`) — keep `categorize`. `competitive-todoist.md` says explicitly to cut anything that narrows the gap to a to-do app.
6. Google **Tasks** sync (date-only; the time portion is discarded). Keep Google **Calendar**.
7. **Household sharing** — no member/invite/permission model exists anywhere in `server/src/models`, so it is multi-tenancy plus an invite flow plus per-matter ACLs. Cozi sells a whole household for $39/yr. Park it — and note that Feature 1 makes it *more* valuable later, because a shared renewal ledger for a couple is a genuinely better product than a shared task list.

**Dead wiring to remove:** the 30/300 AI-message quota (both numbers wrong in the same direction, so
the paywall never fires); `notifications.emailDigest` and `notifications.marketing` (stored, toggled
in the UI, **read by nothing**); `/me/integrations` and `/me/billing/invoices` (both return hardcoded
`[]`); the `STRIPE_*` keys in `server/.env` that no code reads; `ScannedDocument.rawExtractedText`
(declared, never written); `VOICE_NOTE_SOURCES` entries for `widget`/`dynamic_island`/`lock_screen`
(no such surfaces exist); `package.json`'s `android:dev`/`android:open` (no `android/` directory).

**Stale comments that will mislead the next reader:** `queries/documentScans.ts:170` ("the dashboard
still uses static placeholder data" — false, it uses real data); `me.integrations.ts:7-8` ("the
frontend shows preview tiles in a coming-soon state" — false, both halves); `toolRunner.ts:46`
("six tools" — there are 11); `server/README.md:4` ("The React Native app under `../`").

**Docs that claim shipped features that do not exist:** `primitives.md:30,350` (CitationChip
"✅ built"), `features.md:63,76` + `primitives.md:407,440` + `ARCHITECTURE.md:40` (a briefing tab and
`components/tasks/` — both fiction), `overview.md:22` (`app/chat.tsx`, and "each state-changing call
confirmed by the user").

---

## 9. Timeline

| Track | Phase | Work | Duration |
|---|---|---|---|
| **A** | 0 | Stop the bleeding (§1) — also becomes the pitch's security chapter | **1 day** |
| **A** | G1 | LangGraph migration, RAG decision, Langfuse, Docker/CI-CD — see [`GRADUATION-PLAN.md`](GRADUATION-PLAN.md) | **~3 weeks** |
| **A** | G2 | Pitch video + written rubric answers | **~3 days** |
| **B** | 1 | Correctness, legal, deploy, the three hero-loop breaks (§2) | **~2 weeks** |
| **B** | 2 | RevenueCat, entitlements, margin levers, free tier, paywall (§3) | **~2 weeks** (70h) |
| **B** | 3 | Structured facts → the specific reminder + the morning brief (§4) | **~3 weeks** |
| **B** | 4 | Store submission, ASO, first 100 users (§5) | **ongoing** |

Phase 0 and most of Phase 1 (deploy, observability, security) are **shared** — they are rubric items
*and* launch blockers, so that work is never wasted regardless of which track you finish.

**≈3 weeks to a defensible graduation submission; ≈8 further weeks to a product that can be sold.**

The three things that must be true before the first paying user exists, in order:

1. Gemini is off the free tier and behind a billing cap.
2. Documents are in object storage, not container disk.
3. `resolveTier()` reads the database.

Everything else can slip. Those three cannot.

---

## 10. The next 30 days

Track A owns the calendar; Track B items run only where they don't compete for time.

1. **Phase 0 today** (~1 day). It is a launch blocker *and* the raw material for the pitch's security chapter, which reviewers say is near-zero across the whole cohort.
2. **Start [`GRADUATION-PLAN.md`](GRADUATION-PLAN.md).** The BLOCKING-class items (agent framework, RAG decision, LLM justification) get answered **in writing first** — the reviewer notes are explicit that these are the expensive-to-change-later ones.
3. **Run the concierge test before building Phase 3.** Extract by hand from 5–10 real people's documents and count the deadlines surfaced that they didn't already have written down. That number is the product thesis.
4. **Ask 15 people whether they'd photograph a passport into your app.** Determines whether the Expiry Wall is what you build or what you skip.
5. **File the Apple Paid Applications Agreement** — verify Egyptian payout eligibility. Long external latency, zero effort to start, and it blocks nothing else in the meantime. Only relevant if Track B is actually happening; skip if graduation is the end of the road.
