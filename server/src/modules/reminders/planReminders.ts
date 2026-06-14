import { logger } from '../../logger'
import { Task, type TaskDoc } from '../../models/Task'
import { isAiConfigured } from '../ai/provider/geminiClient'
import { computeRulesReminders } from './leadTime'
import { suggestReminderTimes } from './aiReminderPlanner'

const DAY_MS = 86_400_000
// Only spend an AI call when the deadline is far enough out that smart lead-time
// judgment actually matters; near-term reminders use the rules floor alone.
const AI_REFINE_MIN_HORIZON_MS = 2 * DAY_MS

// Write the deterministic (rules-table) reminder schedule onto a reminder task.
// Overwrites `reminders` fresh (firedAt cleared) — call ONLY when dueAt/kind
// changes, so already-fired reminders aren't reset. Non-reminder / dateless
// tasks get an empty schedule. Never throws: a scheduling hiccup must not fail
// the task mutation that triggered it. (The async AI refinement is added in a
// later phase and layered on top of this floor.)
export async function setRulesReminders(task: TaskDoc, now: Date = new Date()): Promise<void> {
  try {
    const entries = computeRulesReminders(
      { title: task.title, domain: task.domain, kind: task.kind, dueAt: task.dueAt ?? null },
      now,
    )
    task.set(
      'reminders',
      entries.map((e) => ({ at: e.at, kind: e.kind })),
    )
    await task.save()
    // Hybrid: refine far-out schedules with AI (async, fire-and-forget). The
    // rules floor above stands if AI is off / over-quota / fails.
    if (task.dueAt && task.dueAt.getTime() - now.getTime() > AI_REFINE_MIN_HORIZON_MS) {
      void refineWithAi(task.id)
    }
  } catch (err: unknown) {
    logger.warn({ err, taskId: task.id }, 'reminder:schedule-failed')
  }
}

// Refine a reminder task's schedule with AI, falling back silently to the rules
// floor already on the task. Re-reads the task so it never clobbers a reminder
// that already fired (firedAt set) between scheduling and refinement.
export async function refineWithAi(taskId: string): Promise<void> {
  if (!isAiConfigured()) return
  const now = new Date()
  try {
    const task = await Task.findById(taskId)
    if (!task || task.kind !== 'reminder' || !task.dueAt) return
    if (task.reminders.some((r) => r.firedAt)) return
    const due = task.dueAt

    const valid = (await suggestReminderTimes(task, now)).filter(
      (d) => d.getTime() > now.getTime() && d.getTime() <= due.getTime(),
    )
    if (valid.length === 0) return // keep the rules floor

    const entries: { at: Date; kind: 'ai' | 'due' }[] = valid.map((at) => ({ at, kind: 'ai' }))
    // Always keep a nudge at the deadline itself.
    if (!valid.some((d) => Math.abs(d.getTime() - due.getTime()) < 60_000)) {
      entries.push({ at: due, kind: 'due' })
    }
    // Dedup by minute, sorted.
    const seen = new Set<number>()
    const deduped = entries
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .filter((e) => {
        const k = Math.floor(e.at.getTime() / 60_000)
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })

    task.set('reminders', deduped)
    await task.save()
    logger.info({ taskId, count: deduped.length }, 'reminder:ai-refined')
  } catch (err: unknown) {
    logger.warn({ err, taskId }, 'reminder:ai-refine-failed')
  }
}

// A snoozed task fires once, at the snooze moment — that's the point of snooze.
export async function setSnoozeReminder(task: TaskDoc): Promise<void> {
  try {
    if (!task.snoozedUntil) return
    task.set('reminders', [{ at: task.snoozedUntil, kind: 'due' }])
    await task.save()
  } catch (err: unknown) {
    logger.warn({ err, taskId: task.id }, 'reminder:snooze-schedule-failed')
  }
}
