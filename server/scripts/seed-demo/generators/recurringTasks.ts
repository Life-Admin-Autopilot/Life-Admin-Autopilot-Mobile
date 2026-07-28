import type { Types } from 'mongoose'

import { RECURRING, type Cadence, type RecurringCommitment } from '../catalog/recurring'
import { CURRENCY, COMPLETION, FUTURE_HORIZON_DAYS } from '../config'
import { addDays, cairo, clampDayOfMonth, partsAt, startOfDay } from '../calendar'
import type { Rng } from '../rng'
import { makeTask, type TaskSeed } from './taskFactory'

// The recurring spine: every instance of every standing commitment across the
// whole window, past and near-future.

const STEP_MONTHS: Record<Cadence, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

// Absolute month index, so "every 3rd month anchored on October" is one modulo
// rather than a calendar walk that has to special-case December.
function monthIndex(instant: Date): number {
  const p = partsAt(instant)
  return p.year * 12 + (p.month - 1)
}

function dueDatesFor(c: RecurringCommitment, from: Date, to: Date): Date[] {
  const step = STEP_MONTHS[c.cadence]
  const phase = ((c.anchorMonth ?? 1) - 1) % step
  const out: Date[] = []

  for (let m = monthIndex(from); m <= monthIndex(to); m += 1) {
    if (m % step !== phase) continue
    const year = Math.floor(m / 12)
    const month = (m % 12) + 1
    const due = cairo(year, month, clampDayOfMonth(year, month, c.day), c.hour)
    if (due >= from && due <= to) out.push(due)
  }
  return out
}

function money(rng: Rng, range: [number, number]): string {
  // Rounded to the nearest 5 — nobody's electricity bill is 1,247.83 in a note
  // someone wrote themselves.
  const raw = rng.int(range[0], range[1])
  return `${Math.round(raw / 5) * 5} ${CURRENCY}`
}

function noteFor(c: RecurringCommitment, due: Date, rng: Rng): string | undefined {
  const bits: string[] = []
  if (c.amount) bits.push(`About ${money(rng, c.amount)}.`)
  if (c.issuer) bits.push(c.issuer)
  if (c.note) bits.push(c.note)
  if (bits.length === 0) return undefined
  // Monthly bills read better with the period they cover.
  if (c.cadence === 'monthly' && c.amount) {
    const p = partsAt(addDays(due, -20))
    const month = new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString('en-GB', {
      month: 'long',
      timeZone: 'UTC',
    })
    bits.unshift(`${month} period.`)
  }
  return bits.join(' ')
}

export function buildRecurringTasks(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  windowStart: Date
}): TaskSeed[] {
  const { rng, userId, now, windowStart } = args
  const horizon = addDays(now, FUTURE_HORIZON_DAYS)
  const todayStart = startOfDay(now)
  const out: TaskSeed[] = []

  for (const c of RECURRING) {
    for (const dueAt of dueDatesFor(c, windowStart, horizon)) {
      // Created a week to a month before the deadline — and never in the
      // future, never before the account existed.
      const wanted = addDays(dueAt, -rng.int(7, 28))
      const createdAt = new Date(
        Math.min(
          Math.max(wanted.getTime(), windowStart.getTime()),
          now.getTime() - rng.int(1, 6) * 3_600_000,
        ),
      )

      const past = dueAt < todayStart
      const binned = past && !rng.chance(COMPLETION.doneRate)

      let completedAt: Date | undefined
      let deletedAt: Date | undefined
      let status: 'open' | 'done' = 'open'

      if (past && !binned) {
        status = 'done'
        const shift = rng.chance(COMPLETION.earlyRate)
          ? -rng.int(0, 3) // closed early: the default for this persona
          : rng.int(0, 2)
        const at = addDays(dueAt, shift)
        // Can't be finished before it was written down, and can't be
        // finished in the future.
        completedAt = new Date(
          Math.min(Math.max(at.getTime(), createdAt.getTime() + 60_000), now.getTime()),
        )
      } else if (binned) {
        const at = addDays(dueAt, rng.int(1, 20))
        deletedAt = new Date(Math.min(at.getTime(), now.getTime()))
      }

      out.push(
        makeTask(
          {
            userId,
            title: c.title,
            domain: c.domain,
            kind: c.kind,
            priority: c.priority,
            status,
            createdAt,
            dueAt,
            notes: noteFor(c, dueAt, rng),
            tags: c.tags,
            // Not everything carries an estimate — the surfaces that render
            // one all have to survive its absence, so the dataset has to
            // contain that case in bulk.
            estimate: rng.chance(0.72) ? c.estimate : undefined,
            subtaskTexts: c.subtasks,
            completedAt,
            deletedAt,
          },
          now,
          rng,
        ),
      )
    }
  }

  return out
}
