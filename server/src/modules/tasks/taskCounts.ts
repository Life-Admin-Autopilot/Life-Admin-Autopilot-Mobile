import type { Types } from 'mongoose'
import { Clarification, visibleOpen } from '../../models/Clarification'
import { ScannedDocument } from '../../models/ScannedDocument'
import { Task, notDeleted } from '../../models/Task'
import { dayBoundaries, toUserObjectId } from './taskQuery'

// Bucket counts for the Matters header, the filter badges, and the dashboard.
//
// The buckets are deliberately the same ones the list groups by, computed from
// the same boundaries, so a section header reading "TODAY 3" can never disagree
// with the badge above it.
//
// This is also the DASHBOARD's count source, and that is the whole point of it.
// Every number on home used to come from /me/digest, which awaits a Gemini call
// to write its headline before it returns anything at all. The counts were
// computed in milliseconds and then held hostage by a sentence — so "Needs you"
// appeared visibly later than the matters list beside it, and worse, it appeared
// LATE precisely when the user had just changed something (a changed fingerprint
// is exactly what misses the digest cache). Counts are deterministic and cheap;
// prose is neither. They are served separately now. See modules/tasks/dailyDigest.

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
  // Finished inside the caller's local day — the numerator of the day-progress
  // pill. Distinct from `done`, which is every matter ever completed.
  completedToday: number
  // The two other "needs you" inboxes, so the dashboard strip resolves from ONE
  // request instead of racing a fast query against a slow one.
  needsInput: number
  scansAwaitingReview: number
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
        completedToday: [
          {
            $match: {
              userId: uid,
              status: 'done',
              completedAt: { $gte: todayStart, $lt: tomorrowStart },
            },
          },
          { $count: 'n' },
        ],
        byDomain: [{ $match: live }, { $group: { _id: '$domain', n: { $sum: 1 } } }],
        byPriority: [{ $match: live }, { $group: { _id: '$priority', n: { $sum: 1 } } }],
      },
    },
  ])

  // Three collections, so three reads — but concurrent, and all of them are
  // covered index counts. Trash lives outside the main $match (which excludes
  // deleted rows), so it needs its own query too.
  const [trashed, needsInput, scansAwaitingReview] = await Promise.all([
    Task.countDocuments({ userId: uid, deletedAt: { $exists: true } }),
    // visibleOpen() — NOT `status: 'open'`. A question the user skipped is
    // deferred, not outstanding, and counting it would re-assert an obligation
    // they explicitly put down. Composing the shared predicate is what keeps
    // this in step with the /uncertainties list. See models/Clarification.
    Clarification.countDocuments({ userId: uid, ...visibleOpen(now) }),
    // `ready_for_review` is the TERMINAL SUCCESS state of scanning, not a
    // to-do: every document that scanned cleanly keeps it forever, confirmed or
    // not. `reviewedAt` is what the server stamps once every candidate has been
    // resolved, so its ABSENCE is the real "needs you". The digest's own
    // fingerprint omits this guard and therefore overcounts; the dashboard was
    // already filtering client-side to compensate.
    ScannedDocument.countDocuments({
      userId: uid,
      status: 'ready_for_review',
      reviewedAt: { $exists: false },
    }),
  ])

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
    completedToday: scalar('completedToday'),
    needsInput,
    scansAwaitingReview,
    byDomain: group('byDomain'),
    byPriority: group('byPriority'),
  }
}
