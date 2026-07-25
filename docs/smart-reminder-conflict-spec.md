# Feature Spec: Smart Conflict-Aware Reminder System

## 1. The Problem

Every reminder app on the market — including v1 of this product — does the same thing: it stores a due date and fires a notification when the clock hits it. This is the entire "intelligence" of category-defining tools like Apple Reminders, Todoist, and Google Tasks. It breaks down in three predictable ways:

- **Notification pile-ups.** When several tasks happen to be due around the same time, the user gets several separate pings, each demanding equal attention regardless of actual importance.
- **False sense of safety.** A due-date-only system can't tell the difference between "renew car insurance sometime this month" and "renew car insurance in the next 20 minutes or the policy lapses" — both just look like a timestamp.
- **No awareness of the user's real schedule.** These systems have no concept of how long a task actually takes, so they can't tell a user that two things they've committed to don't actually fit in the time available.

The result, industry-wide, is notification fatigue: users mute, snooze, or ignore reminders, which defeats the product's entire purpose. (Anecdotal and published UX research on notification fatigue shows batched/ranked delivery drives materially higher engagement and lower opt-out than one-at-a-time alerts.)

## 2. The Core Insight

A reminder system becomes genuinely useful the moment it stops treating "when" as a single fixed instant and starts treating it as three separate, combinable signals:

1. **How urgent is this, in the user's own words** (priority)
2. **How much time does this actually need, and how flexible is that** (a window, not a point)
3. **What else is competing for the user's attention in that same window** (conflict)

None of the mainstream to-do apps combine all three. The calendar-scheduling category (Reclaim.ai, Motion) does combine them — but only for calendar time-blocking, not for lightweight reminder/task capture from natural conversation. This product's position is: bring calendar-grade scheduling intelligence to the reminder layer, driven by the same AI extraction pipeline that already turns a voice note into a structured task — with zero extra input burden on the user.

## 3. How It Works

### 3.1 Priority as a real signal, not a label

Every task already gets a priority (low / normal / high / urgent), inferred automatically from how the user phrases the task ("asap," "important," "no rush") at the moment it's captured — no manual tagging required. Today, in most systems (including our own v1 build), this sits decoratively; it's stored but never actually used to make a decision. In this design, priority becomes an input to a single combined **urgency score**, not a standalone label:

```
urgency_score = f(priority_weight, time_remaining, task_domain)
```

This score is what actually decides which reminder gets the user's attention first when more than one is competing for it.

### 3.2 Auto-detected time windows, not fixed buffers

Instead of asking "is this task due at exactly 3:00pm," the system asks "what's the realistic window this task occupies." That window is derived automatically, in layers:

- **Layer 1 — AI-estimated at capture time.** The same AI step that already reads a voice note and produces a title, domain, and priority also infers a realistic duration/window for the task from context — "renew car insurance" implies a different window than "pick up dry cleaning" or "prep board meeting slides." No new user input required.
- **Layer 2 — domain-informed fallback.** If the AI's estimate is low-confidence, the system falls back to a domain-typical default (a bill-payment task and a car-maintenance task have structurally different typical durations) rather than one arbitrary constant applied to everything.
- **Layer 3 — learns from the user over time.** The system observes how long this user actually takes to act on tasks of a given type (time from creation to completion, time from reminder-fired to completion) and calibrates future window estimates to that individual's real behavior. This is the layer that makes the system genuinely "auto-detected" rather than just "pre-guessed once" — it gets more accurate the longer someone uses the product, which is a natural retention and data moat.

### 3.3 Real conflict detection, not just "is the date close"

A conflict isn't "two tasks happen to share a due date." It's "two tasks' effective time windows — including the buffer each realistically needs — overlap." The system merges each task's window (padded with its buffer) and only flags a true conflict when there isn't enough breathing room between them. This is the same class of algorithm calendar-scheduling products use to detect double-bookings and over-scheduled days — applied here to a plain-language task list instead of a calendar grid.

When a conflict is detected, the urgency score (3.1) decides which task is presented as the priority and which is flagged for the user to reschedule or acknowledge — the system proposes a resolution instead of just alerting that a problem exists.

### 3.4 Notification batching instead of one-at-a-time pings

When multiple reminders land in the same window, they don't fire as separate, uncoordinated pushes. They're evaluated together, ranked by urgency score, and delivered as a single prioritized bundle — the highest-urgency item surfaced prominently, lower-urgency items folded into a digest rather than each interrupting the user independently. This mirrors the pattern platform-level systems (e.g. iOS notification summaries) use to fight fatigue, but applied at the task-relevance layer rather than just the OS delivery layer.

## 4. Why This Is Defensible

- **Zero added user friction.** All of the intelligence (priority, window, conflict, batching) is inferred from the same natural-language capture the user already does — nothing about the input experience changes.
- **Compounding personalization.** The window-calibration layer (3.2, Layer 3) means the system's accuracy is a function of usage history per user — a data advantage that grows with retention and is not trivially replicable by a competitor starting from zero.
- **Category gap.** Calendar-scheduling intelligence (Reclaim, Motion) and lightweight AI task capture (Todoist AI, Apple Reminders) currently live in separate product categories. Combining them in the reminder layer is not something either category's incumbents are structurally positioned to do without a significant product pivot.

## 5. Phased Build Roadmap

**Phase 1 — Priority becomes load-bearing**
Wire the existing (already-inferred) priority field into an urgency score used for reminder ordering and notification ranking. No schema changes; closes an existing gap where priority is captured but currently has no downstream effect.

**Phase 2 — Auto-detected windows**
Add AI-estimated duration/window inference to the existing extraction step; add domain-default fallback. Replace single-instant `dueAt` reminders with window-aware scheduling.

**Phase 3 — Conflict detection**
Implement interval-merge conflict checking across a user's active tasks/windows; surface detected conflicts with a proposed resolution driven by urgency score.

**Phase 4 — Notification batching**
Group reminders that land in the same window into a single ranked, prioritized delivery instead of independent pings.

**Phase 5 — Behavioral calibration loop**
Track actual user behavior (creation-to-completion time, reminder-fired-to-completion time) per task type/domain, and use it to continuously recalibrate window estimates per user — the compounding personalization layer described in Section 4.

Phases 1–2 are foundational and low-risk (extend an existing AI extraction call and existing data model). Phases 3–5 are where the product differentiates meaningfully from every due-date-only competitor in the category.
