# Kitto — Business Model

> Written 2026-07-28. Supersedes the pricing paragraph in `competitive-todoist.md`.
> Every cost figure here was **measured** against the code, not estimated. Every market
> figure carries a source. Where something is a guess, it says so.

---

## 1. The honest situation

Three facts set the frame. None of them are opinions.

**You cannot sell anything today.** `resolveTier()` in `server/src/modules/ai/routes.ts:26` hardcodes
`return 'free'` for every user. Four more sites hardcode `tier: 'free'`. Nothing anywhere sets
`subscription.tier = 'pro'`. There is no payment provider — `me.billing.ts` returns an empty array,
and `UpgradeSheet.tsx` correctly says "Pro isn't open yet." Even with checkout wired tomorrow, a
paying customer would receive free limits. **Selling is a build task, not a decision.**

**Your best customers currently lose you money.** Measured AI cost is ~$3.29/month for an engaged
user and ~$9.34/month for a heavy one. At $7.99/mo with a 15% store cut you keep $6.79 — so a heavy
user is −$2.55/month. Not at scale. Per user, on day one.

**The base rate is brutal.** Only **17.3%** of subscription apps reach $1K MRR and **4.6%** reach
$10K MRR within two years. Apps launched 2025+ hold **3%** of all subscription revenue; pre-2020 apps
hold 69%. ([RevenueCat 2026](https://www.revenuecat.com/state-of-subscription-apps), 115k+ apps)

**What follows from that:** Kitto as a consumer subscription is unlikely to replace an income within
six months. That is not a judgement on the product — it is what the distribution of outcomes looks
like. The plan below is therefore built to *find the market cheaply* and *generate cash early*,
rather than to optimise a funnel that does not have traffic in it yet.

---

## 2. Do this first (this week, ~1 hour, no code)

**Set a hard billing cap on the Google Cloud / Gemini project.** Pick a number you can stand losing
— $20, $50. This converts every cost hole in §6 from a threat into "the API stops answering."

This matters because the audit found that `POST /me/voice-notes` has a rate limiter but **no quota
check** (`me.voiceNotes.ts:76`), while the near-identical `/ai/voice/transcribe` does gate. At 12/min
sustained, one account can push 17,280 voice notes/day — **$108/day** at 60-second notes, **$619/day**
at max size, up to **~$1,300/day** with uncapped thinking. And `requireAuth` only verifies the JWT
signature; it never loads the user, so `emailVerifiedAt` is written by the verification route and
**read by nothing**. Throwaway emails multiply it without limit.

Nothing is deployed yet (no Dockerfile, no host config, `.env.production` → `api.example.com`), so
this is a pre-launch fix, not a live fire. But the cap goes on before the server ever gets a public
URL.

---

## 3. Pricing

### The structure

| | What it is | Price |
|---|---|---|
| **Free, forever** | The app **without AI**: manual matters, reminders, document storage (cap ~20), export | $0 |
| **Trial** | Full AI, 7 days, on signup | $0 |
| **Kitto Plus** | The AI: scan→extract, voice→matters, chat, daily digest, unlimited documents | **$8.99/mo or $59/yr** |
| **Top-ups** | Optional, only when fair use is exceeded | +20 scans $4.99 · bulk import 200 docs $29 |

### Why this shape

**The free tier costs you nothing to serve.** This is the whole trick. A free tier that burns Gemini
is a hole; a free tier that only stores files is a rounding error. Users keep their data forever
(which is the trust promise a document vault lives on), and they upgrade when they want the magic —
not when they hit an arbitrary counter.

**Charge for AI, not for "AI questions."** Your current model gates *30 AI messages/day free vs 300
Pro* (`env.ts:41-42`). Both numbers are wrong in the same direction: no real life-admin user
approaches 900 messages/month, so the paywall never fires for genuine users — only for abusers — and
300/day is a ceiling nobody reaches, so Pro visibly sells nothing. You are gating a **cost input**
where you should be gating a **capability**.

**$59/year is the headline, $8.99/month is the anchor.** They are the same product and they feel
completely different. Median annual price in this category is **$34.80**; Cozi charges **$39/yr for a
whole household**; Everplans charges **$99.99/yr**. The 45% annual discount sits inside the normal
25–45% band. Annual also front-loads cash, which matters when you have none.

**Why $59 and not $49.** $49/yr nets $3.47/mo after a 15% store cut, against a measured $3.29/mo
engaged-user cost — a **5% margin**, and still negative on heavy users even after the §6 fixes. The
category median pulls toward $49; your COGS does not permit it. $59 nets $4.18/mo (21% today, ~45%
post-fix); $69 nets $4.89 (33% / 53%). Selling through the web via a merchant-of-record (~5% rather
than 15%) improves each of these by roughly $0.45/mo.

**Turn on store regional pricing.** This resolves the "is $8.99 too expensive?" question without you
having to answer it. Apple and Google adjust by market automatically — $8.99 in the US shows as
roughly $2–3 in Egypt. RevenueCat measures NA conversion at **2.8%** vs **0.7%** in India/SEA;
regional pricing is how you serve both without wrecking either.

**Do not launch a perpetual free AI tier.** Hard paywall converts **10.7%** vs freemium **2.1%** — 5x
— and returns **$3.09 vs $0.38** revenue per install at D60, with **no meaningful retention penalty**
(27% vs 28% at one year). For a founder who cannot absorb free-user COGS, this is the single
highest-leverage decision available.

**Trial length: 7 days minimum, 14 if costs are fixed first.** Trial→paid runs **25.5%** at ≤4 days,
**37.4%** at 5–9 days, **42.5%** at 17–32 days. Yet 46.5% of apps ship ≤4-day trials. Longer converts
better — it just costs more AI while it runs, so §6 gates how generous you can be.

### Credits vs flat — and the fair-use ceiling

**Considered and rejected as the headline model.** Credits make COGS track revenue, which is the
property a founder who cannot absorb loss most wants, and they would permit a lower entry price. But
every consumer product using them well is B2B or prosumer — Motion at $34/mo (7,500 credits/seat,
$0.25/100 overage), Notion at $10/1,000 credits, both expensed by someone other than the user. At the
$5–10 consumer tier flat pricing dominates, for three reasons specific to Kitto:

- **Credits cause rationing.** Less usage → weaker habit → more churn, and AI apps already churn ~30%
  faster than non-AI (21.1% vs 30.7% annual retention). Suppressing the loop is the wrong trade.
- **"500 credits" is unanswerable at the point of sale.** Productivity converts **71.9% on Day 0** —
  the decision is instant, and anything requiring arithmetic at that instant costs conversions.
- **It contradicts the product test.** `principles.md`: *does this make life admin feel less
  stressful, not more?* A balance ticking down while you scan an insurance policy is the opposite of
  the relief this product sells.

**Adopted instead — flat price with an invisible ceiling.** Set fair use at **5–10× normal usage**
(≈40 scans, 100 voice notes, 300 chat messages per month) so ~95% of users never discover it exists.
On breach, offer a top-up rather than a wall. This buys the cost ceiling without the credit anxiety —
the pattern Otter, Voicenotes and Granola all use.

**Where credits genuinely are correct:**

1. **Bulk import.** "Digitize my filing cabinet" is ~200 documents and a real $10–20 COGS event. Sell
   it as a pack (200 docs, $29) — it should not be absorbed by a $59 subscription. This is also the
   productised form of the §5 concierge offer.
2. **B2B2C.** If the broker route opens, seats + credits is the native model there.

### What NOT to do

**No lifetime deal.** I was going to recommend one for fast cash. The research kills it:
ChatPlayground AI revoked every lifetime licence it had sold and demanded **$875 from existing
lifetime owners**, citing API costs. Where lifetime survives in AI products it is a *credit bundle*
or *bring-your-own-key*, never unlimited. Structured can sell $99.99 lifetime because it has no AI
COGS. You cannot. Prepaid **2-year** terms are the survivable version if you need cash.

**Do not price at $4.99 to feel accessible.** High-priced apps converted **2.8%** vs **1.4%** for
low-priced, and returned **$62.19 vs $10.69** Year-1 LTV per payer. Cheap does not convert better.
And see §6 — $4.99 does not cover a heavy user even after the cost fixes.

### The ceiling, and the two corpses that mark it

**$40/mo is the category maximum, and it requires humans.** Trustworthy's $480/yr tier includes 3
hours of human concierge. Yohana (Panasonic) charged **$249/mo** for pure human concierge and **shut
down 2025-09-30**. Milo died trying to replace those humans with AI, its founder saying the
technology was *"too early to be reliable in any useful way."* Do not plan a path through that price
band on AI alone.

---

## 4. What free vs paid actually contains

Mapped to what is **built today**, not what is planned.

| Capability | Built? | Free | Plus |
|---|---|---|---|
| Manual matters, domains, reminders | ✅ | ✅ | ✅ |
| Document storage + vault | ✅ | 20 docs | Unlimited |
| Data export (JSON) | ✅ `me.export.ts` | ✅ | ✅ |
| Document scan → extraction | ✅ | ❌ | 30/mo fair use |
| Voice note → matters | ✅ | ❌ | ✅ |
| AI chat + tool calling | ✅ | ❌ | ✅ |
| Daily digest | ✅ | ❌ | ✅ |
| Auto-categorise | ✅ | ❌ | ✅ |
| Clarifications / uncertainties | ✅ | ❌ | ✅ |
| Household sharing | ❌ **not built** | — | Later tier |

**Keep export free.** It is the cheapest trust signal you have, and gating it in a product whose
entire promise is "your important documents are safe here" would undercut the thing you are selling.

**Household sharing does not exist** — there is no member/invite/household model anywhere in
`server/src/models`. A family tier is a real build, not a repackage. Park it.

---

## 5. Revenue lines, ranked by cash-speed for someone with no runway

**1. Concierge setup — do this first.** "Send me your documents; I'll set up your vault and your
renewal calendar. $99." Requires **zero code**. Cash in days. And it answers the question you could
not answer above: *who actually has this pain badly enough to pay?* Ten of these is $990 and a real
customer-discovery dataset. This is the highest-value line in the list for your specific situation,
and it is the one most founders skip because it does not feel like building a product.

**2. Annual subscriptions from one narrow launch.** 50 payers × $49 = $2,450. Requires checkout,
entitlements, and a landing page — none of which exist (`app/page.tsx` is an auth gate; there is no
marketing surface at all).

**3. B2B2C — the pattern both close analogs converged on.** Everplans sells white-labelled through
advisors and insurance agents (**$27/yr via VSP** vs $99.99 direct) and was acquired twice. Prisidio
runs through AARP. Wealth.com's vault is advisor-only. Consumer document vaults consistently struggle
to acquire directly and end up distributed by institutions that already own the customer. One broker
with 300 clients at $2/client/mo = **$600/mo from a single sale**. Needs multi-tenancy you have not
built — but it needs a *demo*, not a finished app.

**4. Insurance renewal referrals — the biggest ceiling, phase 3.** A US renewal referral sells for
**$10–50**; live transfers **$30–75**. Your entire $49 annual subscription is worth 2–6 referrals, and
a household with car + home + health policies generates four renewal events a year. MediaAlpha did
**$310M in Q1 2026** on ~11.7M monthly referrals; EverQuote $190.9M.

You are already sitting on the signal: `ScannedDocument` captures `issuer`, `documentType`, and
per-candidate `dueAt` (`ScannedDocument.ts:149-153`) — *who your current provider is and when your
policy renews* is the highest-intent data in that market.

**Two hard constraints.** TCPA governs consent in the US and one-to-one consent rules make blanket
data-sharing flows legally hazardous; in the UK, introducing insurance business is an FCA-regulated
activity requiring authorisation or appointed-representative status. And selling renewal data from
documents users handed you for safekeeping is a trust cliff — Trustworthy and Everplans notably do
**not** monetise this way. If you ever do it, it must be an explicit, user-initiated "get me a quote"
button, never background monetisation.

**Cheap option to keep now:** add structured `amount` / `premium` fields to the extraction schema.
Small change today; it is the difference between having this option later and not.

---

## 6. Cost work — right-sized to the price you pick

The full audit found 13 issues. Most are scale problems and should wait. **At zero users, context
caching saves nothing.** Do these, in this order, and stop:

| # | Fix | Effort | Why |
|---|---|---|---|
| 0 | **Provider billing cap** | 10 min, no code | Bounds maximum loss regardless of everything below |
| 1 | `thinkingBudget: 0` on the 8 sites missing it | ~8 one-line edits | 20–60% off everything outside chat |
| 2 | Quota on `me.voiceNotes.ts` | ~3 lines | Closes the $108–1,300/day/account hole |
| 3 | Wire `resolveTier()` to the real subscription | small | **Without this, Plus is unsellable** |
| 4 | Downscale images to 1024px long edge | small | 12× fewer media tokens (6,192 → 516) |
| 5 | `maxOutputTokens` (appears **zero times** today) | small | Bounds the tail |

Only 3 of these are strictly required to launch: **0, 2, 3.**

**The trade you are making.** Price and cost work are linked — you can defer one only by accepting
the other:

| Price | Heavy user, today | After fixes 1+4 |
|---|---|---|
| $4.99/mo | −$5.10 | −$1.76 |
| $59/yr (= $4.18/mo net) | −$5.16 | −$1.82 |
| $8.99/mo | −$1.70 | +$1.94 |
| $9.99/mo | −$0.85 | +$2.49 |

**$4.99 never works, even after the fixes.** $8.99 monthly works once fixes 1 and 4 land. That is the
real argument for the higher price — not market positioning, arithmetic.

**Note the annual row.** A heavy user on the $59 annual plan is loss-making even post-fix. This is
precisely what the fair-use ceiling in §3 exists to stop — without it, annual pricing is an
open invitation to your most expensive users. Annual subscribers do skew lighter on average (buy and
forget), so the blended figure is better than this row implies, but the tail is real and must be
capped rather than hoped away.

*(Post-fix figures are estimates derived from the measured "20–60% off everything outside chat";
chat already has thinking configured, so the reduction is applied conservatively. Everything in the
"today" column is measured.)*

**Deferred until you have users:** context caching, lean-projecting `queryTasks` (50 rows = 13,088
tokens of full Mongoose documents including `userId`), the `usage` overwrite at `service.ts:367` that
under-reports token spend by **4.2×**, retry-storm capping, categorise's uncapped tag vocabulary.

**One infrastructure item that is not optional before charging anyone:** documents are written to
**local disk** (`documentScanStorage.ts:23` → `uploads/document-scans`), which is ephemeral on most
hosts. Taking money for "your documents are safe here" while storing them on a container filesystem
is the one risk in this document that could actually generate liability. Move to object storage
(Cloudflare R2 has no egress fees) before the first payment.

---

## 7. The 90-day sequence

**Weeks 1–2 — stop the bleeding, learn something.**
Billing cap. Voice-note quota. Then run **5–10 concierge setups** at $99 by hand. No code. The goal
is not the money — it is finding out which of the three candidate markets actually flinches at the
price and which one says "finally."

**Weeks 3–6 — make it sellable.**
Wire `resolveTier()` to the real subscription. Add checkout. Object storage. `thinkingBudget: 0` and
image downscaling. Build a landing page — you currently have **no acquisition surface whatsoever**.

**Weeks 7–12 — one narrow launch.**
Pick the single market that responded best in weeks 1–2. Launch to it, at $8.99/$49 with regional
pricing on and a 7-day trial. Target: **50 paying users**. Not 5,000.

**Payment rails.** Stripe does not operate in Egypt (confirmed against their country list). Use
**Paddle or Dodo as merchant-of-record** for web — but *verify Egypt seller eligibility with Paddle
directly before building on it*, that is the single highest-stakes unverified item in this research.
Do **not** build on Lemon Squeezy (Stripe-acquired, migrating). The Stripe Atlas US-LLC route ($500 +
~$100/yr) carries a **Form 5472 filing requirement with a $25,000-per-form penalty even at zero
revenue** — do not take that on until web revenue justifies it.

---

## 8. What would tell you to stop

Decide these now, while you are not emotionally invested in the answer.

- **10 concierge offers, zero takers at $99** → nobody has this pain at a price that sustains you.
  That is a market signal, not an execution failure.
- **Landing page live 60 days, under 100 signups** → the positioning is not landing. Change the
  wedge before touching the product.
- **50+ trials, under 5% convert** → the product does not deliver its promise yet. More features will
  not fix it; the hero loop is not closing.
- **Month-1 churn above 50% on annual** → they bought a promise the product did not keep. Category
  baseline is already rough (72% Year-1 annual churn, and AI apps churn ~30% faster than
  non-AI — **21.1% vs 30.7%** annual retention).

**The one to watch hardest:** AI apps earn **41% more per payer** ($30.16 vs $21.37 Year-1) but churn
much faster. Novelty sells the first month; only the daily-value loop keeps them. For Kitto that loop
is the digest and the renewal warnings — and per `features.md`, the *AI-ranked* digest is **not built
yet** (the screen ships as a date-bucketed list; there is no ranking model and no morning scheduler).
That gap is the retention risk, and it is more important than any pricing decision in this document.

---

## Sources

Market: [RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps) ·
[Productivity cut](https://www.revenuecat.com/state-of-subscription-apps-2026-productivity/) ·
[Trustworthy](https://www.trustworthy.com/pricing) · [Everplans](https://www.everplans.com/pricing) ·
[Cozi](https://www.cozi.com/cozi-gold/) · [Todoist](https://www.todoist.com/pricing) ·
[Stripe country list](https://stripe.com/global) ·
[Insurance lead costs](https://www.maverickmarketingllc.com/resources/how-much-do-insurance-leads-cost) ·
[MediaAlpha Q1 2026](https://www.globenewswire.com/news-release/2026/04/29/3284233/0/en/mediaalpha-announces-first-quarter-2026-financial-results.html)

Cost: measured directly against this repo — prompts extracted and counted at runtime, tool schemas
serialised, media billed per Gemini's published rules (32 tok/s audio, 258 tok/image tile).
`gemini-2.5-flash` list pricing: $0.30/M input, $1.00/M audio in, $2.50/M output.

Unverified, flagged: Paddle Egypt seller eligibility · Apple payouts to Egyptian bank accounts ·
Tiimo exact pricing (vendor page 404) · UK/EU/MENA insurance lead values (US data only).
