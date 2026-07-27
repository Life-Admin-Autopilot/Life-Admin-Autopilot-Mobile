import type { Domain } from '../../models/User'
import type { ReminderEntry, TaskKind } from '../../models/Task'

// Smart lead times — how far AHEAD of a deadline to nudge, by task type. Ported
// from the v1 spec (docs/ai-stories.md, Table 8): a passport renewal deserves
// months of warning, a bill days, an appointment a day. Keyword match wins over
// the domain default. This is the deterministic floor; the AI planner may refine.

const DAY_MS = 86_400_000

const KEYWORD_LEAD_DAYS: { re: RegExp; days: number }[] = [
  { re: /passport/i, days: 180 },
  { re: /driv(ing|er).?licen[cs]e|\blicen[cs]e\b/i, days: 60 },
  { re: /registration|\brego\b|\bmot\b/i, days: 45 },
  { re: /insurance|policy|warrant/i, days: 30 },
  { re: /\btax(es)?\b|\bvat\b|filing/i, days: 14 },
  { re: /subscription|membership|renew|expir/i, days: 21 },
  { re: /\bbill\b|payment|invoice|\brent\b|mortgage|utilit|fees?\b/i, days: 5 },
  { re: /appointment|\bappt\b|doctor|dentist|\bvet\b|meeting|call\b|interview/i, days: 1 },
]

const DOMAIN_DEFAULT_LEAD_DAYS: Record<Domain, number> = {
  health: 3,
  home: 5,
  car: 14,
  finance: 5,
  family: 3,
  pets: 3,
}

export interface ReminderTaskShape {
  title: string
  domain: Domain
  kind: TaskKind
  dueAt?: Date | null
}

export function computeLeadDays(task: ReminderTaskShape): number {
  for (const { re, days } of KEYWORD_LEAD_DAYS) {
    if (re.test(task.title)) return days
  }
  return DOMAIN_DEFAULT_LEAD_DAYS[task.domain] ?? 3
}

// Deterministic reminder schedule for a reminder task: a smart lead-time nudge
// (when it's still in the future) plus an at-due nudge. List items / dateless
// tasks get nothing. Past-due reminders just get the 'due' entry (fires next
// tick). Returned sorted, with lead dropped if it collides with due.
export function computeRulesReminders(
  task: ReminderTaskShape,
  now: Date = new Date(),
): Pick<ReminderEntry, 'at' | 'kind'>[] {
  if (task.kind !== 'reminder' || !task.dueAt) return []
  const due = task.dueAt
  const out: Pick<ReminderEntry, 'at' | 'kind'>[] = []

  const leadAt = new Date(due.getTime() - computeLeadDays(task) * DAY_MS)
  // Only schedule the heads-up if it's in the future AND meaningfully before due.
  if (leadAt.getTime() > now.getTime() && due.getTime() - leadAt.getTime() > 60_000) {
    out.push({ at: leadAt, kind: 'lead' })
  }
  out.push({ at: due, kind: 'due' })

  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}
