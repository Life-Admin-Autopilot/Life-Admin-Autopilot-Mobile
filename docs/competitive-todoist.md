# Competitive — Todoist Ramble

> Status: current as of Jan 2026 (Ramble GA). Pricing verified against todoist.com/pricing.
> This doc exists to settle one question: **what does Mo do now that Todoist shipped voice→task?**

## What happened

In Jan 2026 Todoist shipped **Ramble** — real-time voice dictation that turns natural speech into structured tasks. It overlaps Mo's voice-capture hero step closely enough that the capture UX (listening waveform, card-stack of parsed tasks) now looks nearly identical to ours.

Ramble extracts: task name, date/time, priority, project, label, and — on paid plans — deadline and duration. It supports 40+ languages, allows assignee delegation, and does not store or train on audio. It runs on **Google Gemini 2.5 Flash Live via Vertex AI**, so their per-session inference cost is subsidized by a hyperscaler. It is positioned as part of "Todoist Assist," a feature set *inside* the to-do app — not a standalone product.

## Todoist pricing (2026)

| Plan | Price | Voice (Ramble) | Other limits |
|---|---|---|---|
| **Beginner (Free)** | $0 | **10 sessions/mo**, reset 1st of month; deadlines/durations dictated are ignored | 5 projects, 5 MB uploads, 3 filter views, 1-week history |
| **Pro** | **$5 / user / mo** billed yearly ($60/yr), or **$7/mo** monthly | **Unlimited** | 300 projects, 100 MB uploads, reminders, Task Assist AI, calendar layout |
| **Business** | **$8 / user / mo** billed yearly ($96/yr), or **$10/mo** monthly | Unlimited | Team workspace, 500 team projects, 1,000 members/guests, roles + admin |

Pro rose from $4 → $5 in Dec 2025. The takeaway: **voice capture is now a $5 commodity feature bundled into a to-do app, with Google footing the inference bill.**

## The honest read

1. **Don't fight on capture — that war is lost.** We cannot out-price ($5 + hyperscaler subsidy), out-language (40+), or out-distribute (30M+ users) Todoist on "talk → tasks appear." On pure voice-to-task, our novelty is gone.

2. **Ramble overlaps only our *capture step*, and shallowly.** Ramble stores what you say, then **you still do the task.** "Pay utility bills Friday" → it reminds you Friday; you still go pay. It is a capture tool, not an autopilot.

3. **Todoist validated our market and de-risked our biggest question.** A giant proved voice-task has demand *and* that the category leader treats it as a **feature inside a to-do app**, not a product. That answers "is Mo a feature or a product?" decisively: **Mo must not be "a to-do app with voice." Mo is the autopilot.** (See [`overview.md`](overview.md) → "The differentiator".)

## Where Mo competes — four wedges Todoist won't follow into

These are exactly the moat named in [`overview.md`](overview.md); Ramble has none of them.

- **Documents (sharpest weapon).** Ramble can't read your insurance PDF. Our Document-to-Task chain can: photograph the renewal letter → extract date + policy # + premium → linked tasks, each with a [`CitationChip`](principles.md). **Make this the hero, not voice.** No to-do app copies this quickly — it isn't their job.
- **Domain depth.** "Renew passport" in Mo knows: photo + form + fee + ~6-week lead. In Todoist it's a flat string. Lean into structured domain objects (insurance = provider / policy# / renewal / premium), not generic projects.
- **Execution, not reminders.** Todoist reminds; Mo's promise is to *move it forward* — surface the bill amount + pay link, prefill the form, draft the email. Even a thin "here's the amount, here's the link" beats a Friday reminder.
- **Trust / provenance.** Ramble guesses silently — exactly the failure mode that loses trust (wrong date, wrong-car policy, "1/12" misread). Our citation primitive + confidence-gated *asking* (see [`principles.md`](principles.md) → trust contract) is a real, marketable edge on the highest-stakes step.

## Pricing strategy for Mo

Don't try to undercut $5 — that subsidizes Google-priced inference out of our own pocket.

- **Free tier = acquisition on the commodity layer.** Match or slightly beat their ~10 free voice sessions, plus the briefing, so the head-to-head reads "at least as good, free."
- **Charge for the expensive *and* valuable layer:** document scans, the domain vault, and autopilot actions — where willingness-to-pay is real and Todoist isn't.
- **Premium ~$6–9/mo, priced *above* Todoist Pro** — justified only if the autopilot genuinely delivers "handled" vs "listed." If it doesn't yet, don't claim the premium.

## How to apply

When proposing or prioritizing work:

1. **Voice capture is table stakes now — stop pouring polish there.** Match Ramble's capture quality, don't try to exceed it. Spend the budget on the moat.
2. **Bias the roadmap toward documents + domain + execution + citations** — the parts Ramble cannot follow.
3. Run any new feature through the [`principles.md`](principles.md) single product test first, then ask: *does this widen the gap from a to-do app, or narrow it?* If it narrows it, cut it.

## Sources

- [Todoist — Dictate to add tasks with Ramble (limits)](https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF)
- [Todoist Pricing](https://www.todoist.com/pricing)
- [TechCrunch — Todoist lets you add tasks by speaking to its AI (Jan 21, 2026)](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/)
- [PR Newswire — Introducing Todoist Ramble (Gemini 2.5 Flash Live)](https://www.prnewswire.com/news-releases/introducing-todoist-ramble-ai-that-turns-natural-speech-into-structured-tasks-302666143.html)

Related: [`overview.md`](overview.md), [`principles.md`](principles.md), [`features.md`](features.md).
