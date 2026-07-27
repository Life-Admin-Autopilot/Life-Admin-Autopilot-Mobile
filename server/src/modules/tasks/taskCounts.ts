import type { Types } from 'mongoose'
import { Task, notDeleted } from '../../models/Task'
import { dayBoundaries, toUserObjectId } from './taskQuery'

// Bucket counts for the Matters header, the filter badges, and the dashboard
// hero (which ships hardcoded numbers today).
//
// The buckets are deliberately the same ones the list groups by, computed from
// the same boundaries, so a section header reading "TODAY 3" can never disagree
// with the badge above it.

export interface TaskCounts {
  // Live buckets — open/snoozed only. Mutually exclusive and exhaustive.
  overdue: number
  today: number
  tomorrow: number
  thisWeek: number
  later: number
  undated: number
  // Cross-cutting.
  open: number
  done: number
  trashed: number
  // "Needs a look" — the number the triage banner shows. Bounded and recent by
  // construction: research is unambiguous that an unbounded lifetime overdue
  // count is what drives people to delete the app.
  slipping: number
  byDomain: Record<string, number>
  byPriority: Record<string, number>
}

export async function computeTaskCounts(
  userId: string | Types.ObjectId,
  timezone: string | undefined,
  now: Date = new Date(),
): Promise<TaskCounts> {
  const { todayStart, tomorrowStart, dayAfterTomorrowStart, weekEnd } = dayBoundaries(
    now,
    timezone,
  )

  // Aggregation does not cast — see toUserObjectId.
  const uid = toUserObjectId(userId)
  const live = { userId: uid, ...notDeleted(), status: { $in: ['open', 'snoozed'] } }

  const [facet] = await Task.aggregate([
    { $match: { userId: uid, ...notDeleted() } },
    {
      $facet: {
        overdue: [{ $match: { ...live, dueAt: { $lt: now } } }, { $count: 'n' }],
        today: [
          { $match: { ...live, dueAt: { $gte: now, $lt: tomorrowStart } } },
          { $count: 'n' },
        ],
        tomorrow: [
          { $match: { ...live, dueAt: { $gte: tomorrowStart, $lt: dayAfterTomorrowStart } } },
          { $count: 'n' },
        ],
        thisWeek: [
          { $match: { ...live, dueAt: { $gte: dayAfterTomorrowStart, $lt: weekEnd } } },
          { $count: 'n' },
        ],
        later: [{ $match: { ...live, dueAt: { $gte: weekEnd } } }, { $count: 'n' }],
        undated: [{ $match: { ...live, dueAt: { $exists: false } } }, { $count: 'n' }],
        open: [{ $match: { userId: uid, ...notDeleted(), status: 'open' } }, { $count: 'n' }],
        done: [{ $match: { userId: uid, ...notDeleted(), status: 'done' } }, { $count: 'n' }],
        // Slipping: pushed back repeatedly, or overdue by more than a fortnight.
        // Either signals a commitment that isn't real any more.
        slipping: [
          {
            $match: {
              ...live,
              $or: [
                { rescheduleCount: { $gte: 3 } },
                { dueAt: { $lt: new Date(todayStart.getTime() - 14 * 86_400_000) } },
              ],
            },
          },
          { $count: 'n' },
        ],
        byDomain: [{ $match: live }, { $group: { _id: '$domain', n: { $sum: 1 } } }],
        byPriority: [{ $match: live }, { $group: { _id: '$priority', n: { $sum: 1 } } }],
      },
    },
  ])

  // Trash lives outside the main $match (which excludes deleted rows), so it
  // needs its own query.
  const trashed = await Task.countDocuments({ userId: uid, deletedAt: { $exists: true } })

  const scalar = (key: string): number =>
    (facet?.[key]?.[0]?.n as number | undefined) ?? 0

  const group = (key: string): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const row of (facet?.[key] ?? []) as { _id: string; n: number }[]) {
      if (row._id) out[row._id] = row.n
    }
    return out
  }

  return {
    overdue: scalar('overdue'),
    today: scalar('today'),
    tomorrow: scalar('tomorrow'),
    thisWeek: scalar('thisWeek'),
    later: scalar('later'),
    undated: scalar('undated'),
    open: scalar('open'),
    done: scalar('done'),
    trashed,
    slipping: scalar('slipping'),
    byDomain: group('byDomain'),
    byPriority: group('byPriority'),
  }
}
