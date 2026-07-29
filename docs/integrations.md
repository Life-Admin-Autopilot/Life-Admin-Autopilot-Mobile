# Kitto — Integrations

> Written 2026-07-29. Scope decision: **Tier 1 + Tier 2 only.** Tier 3 and the "never" list are
> recorded here so they are not re-researched every quarter.
>
> Confidence is marked throughout. **[C]** = confirmed against primary/official documentation.
> **[U]** = unconfirmed — secondary sources or inference. Do not build on a **[U]** without checking.

---

## 1. The principle that decides every choice here

Every time the research offered a narrow option and a broad one, **the narrow one was both cheaper
and more trustworthy**. Not coincidence: Google and Apple price broad access expensively *because*
it is a privacy liability.

| Broad | Narrow | What the narrow one saves |
|---|---|---|
| `drive.readonly` (Restricted → CASA) | `drive.file` via Picker (**Non-sensitive → no verification at all**) | The audit *and* the $10–20/user bulk-import AI bill |
| Gmail `readonly` (Restricted → CASA) | Forwarding address | The audit *and* reading the user's whole inbox |
| Server-side CalDAV + stored credentials | On-device EventKit | A permanent credential liability |

So the design rule is: **Kitto only ever sees what the user hands it.** That is a stronger promise
than any feature in Tier 2, and it happens to be the cheap build. It is also the only version of
this that survives `principles.md`.

---

## 2. Ranked sources

### Tier 1 — zero auth, zero approval, zero marginal cost

| Source | What Kitto gets | Notes |
|---|---|---|
| **ICS / webcal feeds** | `SUMMARY`, `DTSTART/DTEND`, `RRULE`+`EXDATE`, `LOCATION`, `UID` | School terms, bin days, fixtures. **You expand recurrence yourself** — feeds ship the rule, not the instances. Conditional GET (`ETag`) makes polling ~free. **[C]** |
| **iOS/Android document picker** | Any file in Files — **including iCloud, Drive, Dropbox, OneDrive, Box** via File Provider extensions | A free multi-cloud aggregator. No OAuth, no usage-description string. Apple *prefers* this route — Guideline 5.1.1(iii). **[C]** |
| **Share extension / share target** | PDFs, images, URLs pushed *to* Kitto | Needs a separate iOS app-extension target + App Group. Not a JS drop-in. **[C]** |
| **Camera + `PHPickerViewController`** | New scans, picked photos | PHPicker needs **no** `NSPhotoLibraryUsageDescription`; runs out-of-process. **[C]** |
| **Apple Reminders + device calendars (EventKit)** | Full `EKEvent` / `EKReminder`: title, start/end with tz, `isAllDay`, OS-parsed recurrence, alarms | `@ebarooni/capacitor-calendar` v8.2.0 — matches our Capacitor 8. Foreground-only, no background push. **[C on plugin; [U] on multi-account aggregation — see §5]** |
| **Forwarding address** | Renewal notices, receipts, itineraries, school letters | **Cloudflare Email Routing: unlimited inbound, free on every plan.** **[C]** |

### Tier 2 — free or cheap, but gated

| Source | What Kitto gets | Gate |
|---|---|---|
| **Google Picker + `drive.file`** | Only files the user picks — but **durable** access to them thereafter | **Non-sensitive scope → no verification, no CASA.** **[C]** |
| **Google Calendar events** | Full datetime, `reminders.overrides`, recurrence, attendees, `eventType` | Sensitive → verification (~10 days). No CASA. Watch channels + sync tokens. **[C]** |
| **Google Tasks** | Title, notes, status, `due` — **date only** | Sensitive. **No webhooks** — poll `updatedMin`. **[C]** |
| **DVSA MOT History** | MOT expiry, full test history, mileage, advisories | Free (OGL). ~5 working days to a key. **UK only.** **[C]** |
| **GOV.UK Content API** | Official renewal guidance + stated processing times as JSON | **No key, no registration.** 10 req/s. **UK only.** **[C]** |
| **DVLA VES** | **Tax due date**, MOT expiry, make/model from a registration | **CLOSED as of 2026-07-29** — the portal states *"Registration closed. We are currently not accepting new VES API registrations while we make some system upgrades."* Re-check periodically. **[C]** |
| **NHTSA vPIC** | VIN → make/model/year/engine | No key. **US only.** Vehicle *identity*, not obligations. **[C]** |

### Out of scope (recorded so it is not re-litigated)

**Tier 3 / later:** Microsoft Graph (personal accounts only — work accounts are blocked by the
consent default, not merely warned), council bin feeds, school term feeds, open banking via the
agent-AISP model, Dropbox, OneDrive, Todoist.

**Dead or closed:** GoCardless/Nordigen (winding down, new signups disabled) · insurance APIs
outside the US · Amazon order history (no consumer API; CSV reports killed Mar 2023) · airline APIs
(none — TripIt runs on email parsing) · NHS GP Connect · Notion · TickTick · Things 3 · Any.do ·
Google Keep (Workspace-admin only) · Apple Notes · Drive full scopes · WhatsApp (Meta's reported
Jan 2026 ban on general-purpose AI assistants covers exactly the bot we would build **[U]**).

---

## 3. The traps — read before writing an importer

**3.1 Date-without-time is systemic, not per-source.** Three of four task sources drop time of day:

| Source | Behaviour |
|---|---|
| Google Tasks | *"the time portion of the timestamp is discarded"* — reading or writing a time is impossible |
| **Microsoft To Do** | `dueDateTime` truncated to midnight **and UTC-shifted** — an Apr 15 task can return `2023-04-14T22:00:00` |
| Apple `EKReminder` | Date-only unless hour/min set — **and a due date creates no alarm**; a separate `EKAlarm` is required |
| Todoist | Clean — real `due.datetime` + timezone |

`Task.ts` invalidates a `kind: 'reminder'` without a `dueAt`, and the worker fires at that instant.
So this needs **one policy, decided once, applied everywhere, visible in the citation** — not three
ad-hoc handlings. Microsoft's variant is the dangerous one: naive import fires on the wrong day,
which is `principles.md`'s unrecoverable failure arriving through an integration instead of OCR.

**3.2 Floating times are the expat killer.** School feeds routinely emit
`DTSTART:20260903T090000` — no `Z`, no `TZID`. That means "09:00 wherever the device is." A
Dubai-based user's school run silently moves four hours. **Treat floating `DTSTART` as low
confidence → ask, and put the raw line in the provenance chip.** This is the highest-value place in
the whole integration surface to apply the existing trust contract.

**3.3 Never double-notify.** Calendar events carry `reminders.overrides` — the notifications Google
*will already fire*. `smart-reminder-conflict-spec.md` §1 names notification pile-up as the thing it
exists to fix. If Google nudges at T−10, Kitto stays silent there and nudges where it adds something
Google cannot — T−1 day, "bring the referral letter."

**3.4 Reminders has no write-only consent tier.** Calendar offers
`requestWriteOnlyAccessToEvents`; Reminders offers only `requestFullAccessToReminders`. To write one
reminder we must ask to read the user's entire corpus. Gate it behind an explicit "Import from
Reminders" action with a specific purpose string — **never at onboarding**. **[U on the App Store
review posture — inference, not a documented Apple position]**

**3.5 EventKit cannot carry the reminder guarantee.** Device-local, foreground-only, no background
delivery, nothing on the server. `EKEventStoreChanged` says "something changed" with no diff. Scope
it as a **context and enrichment source**, never a source of truth for a server-scheduled nudge.

**3.6 Every free structured source is single-country.** DVLA/DVSA/GOV.UK are UK-only; vPIC is
US-only; council and school feeds are UK-fragmented. **A German, Emirati, or Singaporean user gets
nothing from Tier 2 except document and email parsing.** Leaning on structured sources quietly makes
Kitto UK-first. That is a strategy decision and should be made deliberately.

---

## 4. Build order

Phases 1–5 need **no third-party approval**, so nothing blocks on a review queue.

| Phase | Scope | Blocked on |
|---|---|---|
| **0** | Verify the assumptions in §5 | A real iOS device |
| **1** | Capture surfaces: document picker, share extension, camera + PHPicker | Xcode (extension target) |
| **2** | **The date-without-time policy** + `User.timezone` promoted to required | — |
| **3** | EventKit: device calendars + Reminders, read-only into the conflict engine; import on confirm | Device verification (§5.1) |
| **4** | ICS/webcal: conditional GET, deterministic recurrence expansion, floating-time handling | — |
| **5** | Forwarding address: Cloudflare Worker, per-user secret token | Cloudflare account + domain |
| **6** | Google OAuth — Calendar + Tasks + Picker `drive.file`, one consent flow, one submission | Google Cloud project; live privacy policy; verified domain |
| **7** | DVSA MOT History + GOV.UK Content API | DVSA key (~5 days) |

**Phase 2 gates 3–7.** Every one of them imports a date without a time.

### Cost discipline

`business-model.md` measures ~$3.29/user/month AI cost against ~$6.79 net. Therefore:

- **Triage in code, not in the model.** `attendees`, `recurrence`, `organizer`, `eventType`,
  `transparency`, `status` settle most of it deterministically — matching `summarize.ts`'s existing
  "detected in CODE, not by the model" pattern.
- **Cache ICS classification on the normalized `SUMMARY` string**, not the event instance. A full
  term of "Swimming — Year 4" collapses to one classification instead of forty.
- **Picker-only means bulk import cannot happen.** Cost control becomes a property of the design
  rather than a policy anyone has to enforce.

---

## 5. Open verification items

Each of these can invalidate a phase. Half a day total; cheapest insurance available.

1. **EventKit multi-account aggregation [U] — highest stakes.** That iOS's `EKEventStore` surfaces
   Google/Outlook/iCloud/subscribed feeds together is well-established platform behaviour but was
   not confirmed against an Apple doc. **The entire zero-cost calendar strategy rests on it.**
2. **`EKReminder` alarm behaviour [U].** That a due date creates no alarm comes from the plugin's
   type surface and third-party writeups — `developer.apple.com` is JS-rendered and could not be
   read. The failure mode is *a reminder that silently never fires*. Verify in Xcode.
3. **ICS feed prevalence [U].** The mechanism is confirmed; the hit rate is not. Hand-sample ~20
   schools and councils in the launch market. If few publish a subscribable URL, Phase 4 moves.
4. **DVLA VES registration status [U].** Reported closed. DVSA MOT History appears open.
5. **DVSA licence terms.** Free and OGL, but there is an intended-use question on the form. Read it
   before building a consumer reminder product on it.
6. **CASA pricing [U].** Reportedly collapsed to ~$540–$1,000/yr self-serve DAST from $15k–$75k. If
   true it reopens Gmail — the only channel for travel, receipts, and warranties. One
   consultancy blog is the only source. **Get a real quote before this changes any decision.**
7. **Meta's chatbot ban [U].** Meta's own policy page 404'd; three secondary sources agree.

---

## 6. Why not an aggregator

Akiflow already pulls from ~20 native integrations plus Zapier's ~8,800. Being the place every tool
drains into is a distribution game won by whoever has the most connectors, and
`competitive-todoist.md` already concluded Kitto must not be "a to-do app with more inboxes."

The sources above are not chosen for coverage. They are chosen because each one feeds something
Kitto uniquely does: **documents**, **life-admin domain knowledge**, and **provenance**. A flat
string from Google Tasks becomes a matter in `car` with a 30-day lead time, a duration estimate, and
a citation — deduped against the same obligation already extracted from the insurance PDF. That is
the product. The integration is just how the string arrives.

Related: [`principles.md`](principles.md) · [`business-model.md`](business-model.md) ·
[`smart-reminder-conflict-spec.md`](smart-reminder-conflict-spec.md) ·
[`competitive-todoist.md`](competitive-todoist.md)
