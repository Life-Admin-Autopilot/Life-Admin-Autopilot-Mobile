import { Types } from 'mongoose'

import { CLARIFY_QUESTIONS } from '../catalog/phrasing'
import { PENDING, VOLUMES } from '../config'
import { addDays, atTime, startOfDay } from '../calendar'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'
import type { TaskSeed } from './taskFactory'

// The questions Kitto held back rather than guessing at.
//
// Open ones drive the home banner and the /uncertainties card stack; resolved
// ones are the audit trail behind matters that exist because the user answered
// something. All three `kind`s appear among the open set on purpose — each one
// renders differently, and a stack that only ever shows date pickers leaves
// two thirds of that screen unexercised.

export function buildClarifications(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  windowStart: Date
  /** Resolved clarifications point at matters that already exist. */
  tasks: TaskSeed[]
}): SeedDoc[] {
  const { rng, userId, now, windowStart, tasks } = args
  const todayStart = startOfDay(now)
  const span = todayStart.getTime() - windowStart.getTime()
  const linkable = rng.shuffle(tasks.filter((t) => !t.deletedAt))

  const out: SeedDoc[] = []

  for (let i = 0; i < VOLUMES.clarifications; i += 1) {
    const open = i < PENDING.openClarifications
    // Guarantee the open set covers every kind rather than trusting a roll.
    const q = open
      ? CLARIFY_QUESTIONS[i % CLARIFY_QUESTIONS.length]!
      : rng.pick(CLARIFY_QUESTIONS)

    const source = linkable[i % linkable.length]!
    const createdAt = open
      ? atTime(addDays(todayStart, -rng.int(0, 6)), rng.int(9, 21))
      : new Date(windowStart.getTime() + Math.pow(rng.next(), 0.75) * span)

    // A dropped hold is one the user swiped away without answering.
    const dropped = !open && rng.chance(0.04)
    const status = open ? 'open' : dropped ? 'dropped' : 'resolved'

    const options = q.options.map((label, n) => ({
      label,
      dueAt:
        q.kind === 'date'
          ? atTime(addDays(createdAt, n === 0 ? 2 : 4), 10)
          : undefined,
      title: q.kind === 'detail' ? undefined : undefined,
    }))

    const resolvedAt =
      status === 'resolved'
        ? new Date(
            Math.min(createdAt.getTime() + rng.int(60_000, 3 * 86_400_000), now.getTime()),
          )
        : undefined

    out.push({
      _id: new Types.ObjectId(),
      userId,
      status,
      draft: {
        title: source.title,
        domain: source.domain,
        priority: 'normal',
        tags: [],
        dueAt: source.dueAt,
      },
      question: q.question,
      kind: q.kind,
      options,
      answer:
        status === 'resolved'
          ? q.options.length > 0
            ? rng.pick(q.options)
            : 'Call it the quote for the balcony sealing.'
          : undefined,
      createdTaskId: status === 'resolved' ? source._id : undefined,
      resolvedAt,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
    })
  }

  return out
}
