import type { Types } from 'mongoose'

import { ONE_OFFS, type OneOffTemplate } from '../catalog/oneOffs'
import { TASK_NOTES } from '../catalog/phrasing'
import { LIVE_BUCKETS, SLIPPING_COUNT } from '../config'
import { addDays, atTime, startOfDay } from '../calendar'
import type { Rng } from '../rng'
import { fillTitle, makeTask, type TaskSeed } from './taskFactory'

// The live backlog — everything the user would actually SEE on opening the app.
//
// Built to exact counts rather than sampled, because this is the half of the
// dataset the UX study is about: every group header on /matters needs rows
// under it, the day's palette needs matters at several times of day, and the
// overdue count needs to be small enough to read as work rather than as a
// telling-off.

// Deadline hours across the day, so groupByTime's morning/afternoon/evening
// tints all appear rather than every matter landing at 9am.
const DAY_HOURS = [8, 10, 12, 14, 17, 19, 21]

interface Placement {
  dueAt?: Date
  status: 'open' | 'snoozed'
  snoozedUntil?: Date
  rescheduleCount?: number
  kind?: 'reminder' | 'list'
}

export function buildLiveTasks(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
}): TaskSeed[] {
  const { rng, userId, now } = args
  const today = startOfDay(now)

  // Templates are consumed without replacement so the live list doesn't
  // accidentally show the same title twice — the only repeats on this screen
  // are the deliberate pair below, which exist for the digest to catch.
  const pool = rng.shuffle(ONE_OFFS)
  let cursor = 0
  const nextTemplate = (): OneOffTemplate => {
    const t = pool[cursor % pool.length]!
    cursor += 1
    return t
  }

  const placements: Placement[] = []

  // Past their date, but not yet a problem.
  for (let i = 0; i < LIVE_BUCKETS.overdue; i += 1) {
    placements.push({
      dueAt: atTime(addDays(today, -rng.int(1, 11)), rng.pick(DAY_HOURS)),
      status: 'open',
      rescheduleCount: rng.int(0, 1),
    })
  }

  // The slipping set: half genuinely ancient, half moved so many times it
  // counts. Both are what taskCounts and the digest call "slipping".
  for (let i = 0; i < SLIPPING_COUNT; i += 1) {
    const ancient = i % 2 === 0
    placements.push({
      dueAt: atTime(
        addDays(today, ancient ? -rng.int(18, 80) : -rng.int(2, 9)),
        rng.pick(DAY_HOURS),
      ),
      status: 'open',
      rescheduleCount: ancient ? rng.int(0, 2) : rng.int(3, 6),
    })
  }

  for (let i = 0; i < LIVE_BUCKETS.today; i += 1) {
    placements.push({ dueAt: atTime(today, DAY_HOURS[i % DAY_HOURS.length]!), status: 'open' })
  }

  for (let i = 0; i < LIVE_BUCKETS.tomorrow; i += 1) {
    placements.push({
      dueAt: atTime(addDays(today, 1), DAY_HOURS[i % DAY_HOURS.length]!),
      status: 'open',
    })
  }

  for (let i = 0; i < LIVE_BUCKETS.thisWeek; i += 1) {
    placements.push({
      dueAt: atTime(addDays(today, rng.int(2, 6)), rng.pick(DAY_HOURS)),
      status: 'open',
    })
  }

  for (let i = 0; i < LIVE_BUCKETS.later; i += 1) {
    placements.push({
      dueAt: atTime(addDays(today, rng.int(7, 85)), rng.pick(DAY_HOURS)),
      status: 'open',
    })
  }

  // Dateless: these are the `list` kind, and they must never carry a deadline —
  // the Task model rejects a `reminder` without one.
  for (let i = 0; i < LIVE_BUCKETS.noDate; i += 1) {
    placements.push({ status: 'open', kind: 'list' })
  }

  for (let i = 0; i < LIVE_BUCKETS.snoozed; i += 1) {
    placements.push({
      dueAt: atTime(addDays(today, rng.int(-6, 12)), rng.pick(DAY_HOURS)),
      status: 'snoozed',
      snoozedUntil: atTime(addDays(today, rng.int(2, 20)), 9),
    })
  }

  const tasks = placements.map((p) => {
    const template = nextTemplate()
    return makeTask(
      {
        userId,
        title: fillTitle(template.title, template.variants && rng.pick(template.variants)),
        domain: template.domain,
        kind: p.kind ?? (p.dueAt ? template.kind ?? 'reminder' : 'list'),
        priority:
          template.priority ??
          rng.weighted([
            ['urgent', 8],
            ['high', 25],
            ['normal', 50],
            ['low', 17],
          ] as const),
        status: p.status,
        // Recent enough to be plausible, and always before the deadline it
        // was created for.
        createdAt: new Date(
          Math.min(
            addDays(now, -rng.int(1, 40)).getTime(),
            (p.dueAt ?? now).getTime() - 3_600_000,
          ),
        ),
        dueAt: p.dueAt,
        notes: template.note ?? (rng.chance(0.3) ? rng.pick(TASK_NOTES) : undefined),
        tags: template.tags,
        estimate: rng.chance(0.55) ? template.estimate : undefined,
        subtaskTexts: rng.chance(0.35) ? template.subtasks ?? STEP_SETS[rng.int(0, 2)] : undefined,
        snoozedUntil: p.snoozedUntil,
        rescheduleCount: p.rescheduleCount ?? 0,
      },
      now,
      rng,
    )
  })

  return [...tasks, ...buildDuplicatePairs({ rng, userId, now })]
}

// Generic step sets, for live matters whose template carries none. A third of
// the live list having steps is what makes the row's progress affordance and
// the detail sheet's checklist worth looking at.
const STEP_SETS: string[][] = [
  ['Find the paperwork', 'Call them', 'Confirm by email'],
  ['Compare two options', 'Decide', 'Pay'],
  ['Book the slot', 'Set a reminder the day before', 'Go'],
]

// Two pairs of identically-titled live matters inside the digest's horizon
// (it only looks at deadlines less than a week out), so findDuplicates has
// something real to surface. Accidental duplicates are what this feature
// exists to catch; a dataset with none never exercises it.
function buildDuplicatePairs(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
}): TaskSeed[] {
  const { rng, userId, now } = args
  const today = startOfDay(now)

  const pairs = [
    { title: 'Chase the refund from the airline', domain: 'finance' as const, tags: ['refund'] },
    { title: 'Book a dermatology appointment', domain: 'health' as const, tags: ['appointment'] },
  ]

  return pairs.flatMap((pair, i) =>
    [0, 1].map((n) =>
      makeTask(
        {
          userId,
          title: pair.title,
          domain: pair.domain,
          kind: 'reminder',
          priority: 'normal',
          status: 'open',
          createdAt: addDays(now, -rng.int(3, 25)),
          dueAt: atTime(addDays(today, i + n + 1), rng.pick(DAY_HOURS)),
          tags: pair.tags,
          estimate: [15, 30],
        },
        now,
        rng,
      ),
    ),
  )
}
