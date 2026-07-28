import type { Types } from 'mongoose'

import { ONE_OFFS, type OneOffTemplate } from '../catalog/oneOffs'
import { TASK_NOTES } from '../catalog/phrasing'
import { COMPLETION, ONE_OFF_TOTAL } from '../config'
import { addDays, atTime, isWeekend, startOfDay } from '../calendar'
import type { Rng } from '../rng'
import { fillTitle, makeTask, type TaskSeed } from './taskFactory'

// The historical one-offs — errands, appointments, chases. Everything here is
// finished or binned: the live backlog is built separately so its shape can be
// stated exactly rather than fallen out of a probability.

const WEIGHTED: (readonly [OneOffTemplate, number])[] = ONE_OFFS.map(
  (t) => [t, t.weight ?? 1] as const,
)

// Deadlines cluster in the evening and at the start of the working day, which
// is when a person actually deals with admin.
const HOURS = [9, 10, 11, 13, 15, 17, 18, 19, 20, 21]

export function buildOneOffTasks(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  windowStart: Date
}): TaskSeed[] {
  const { rng, userId, now, windowStart } = args
  const todayStart = startOfDay(now)
  const span = todayStart.getTime() - windowStart.getTime()
  const out: TaskSeed[] = []

  for (let i = 0; i < ONE_OFF_TOTAL; i += 1) {
    const template = rng.weighted(WEIGHTED)

    // Skewed toward recent: someone's use of an app deepens over three years,
    // so a flat distribution would make year one look identical to year three.
    const position = Math.pow(rng.next(), 0.75)
    let dueAt = new Date(windowStart.getTime() + position * span)
    dueAt = atTime(dueAt, rng.pick(HOURS))
    // Admin doesn't get deadlines on the Egyptian weekend nearly as often.
    if (isWeekend(dueAt) && rng.chance(0.7)) dueAt = addDays(dueAt, 2)
    if (dueAt >= todayStart) dueAt = addDays(dueAt, -rng.int(1, 30))

    const createdAt = new Date(
      Math.max(addDays(dueAt, -rng.int(0, 14)).getTime(), windowStart.getTime()),
    )

    // A dateless item the user ticked off. These never show on the live list
    // (they're done), but they're a real shape in the archive and the detail
    // sheet has to render one without a deadline.
    const dateless = rng.chance(0.12)
    const binned = !rng.chance(COMPLETION.doneRate)

    const shift = rng.chance(COMPLETION.earlyRate) ? -rng.int(0, 3) : rng.int(0, 2)
    const closedAt = addDays(dueAt, shift)

    out.push(
      makeTask(
        {
          userId,
          title: fillTitle(template.title, template.variants && rng.pick(template.variants)),
          domain: template.domain,
          kind: dateless ? 'list' : template.kind ?? 'reminder',
          priority:
            template.priority ??
            rng.weighted([
              ['urgent', 5],
              ['high', 22],
              ['normal', 55],
              ['low', 18],
            ] as const),
          status: binned ? 'open' : 'done',
          createdAt,
          dueAt: dateless ? undefined : dueAt,
          notes: template.note ?? (rng.chance(0.22) ? rng.pick(TASK_NOTES) : undefined),
          tags: template.tags,
          estimate: rng.chance(0.68) ? template.estimate : undefined,
          subtaskTexts: template.subtasks,
          completedAt: binned
            ? undefined
            : new Date(
                Math.min(
                  Math.max(closedAt.getTime(), createdAt.getTime() + 60_000),
                  now.getTime(),
                ),
              ),
          deletedAt: binned
            ? new Date(Math.min(addDays(dueAt, rng.int(1, 25)).getTime(), now.getTime()))
            : undefined,
        },
        now,
        rng,
      ),
    )
  }

  return out
}
