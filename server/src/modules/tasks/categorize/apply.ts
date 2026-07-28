import { Types } from 'mongoose'

import { NotFound } from '../../../lib/errors'
import { Task, notDeleted, type ConfidenceBucket } from '../../../models/Task'
import type { Domain } from '../../../models/User'
import { TaskBulkOp, type TaskBulkOpDoc } from '../../../models/TaskBulkOp'
import { toMongoOps } from '../bulkService'
import type { ProposedChange } from './propose'

// The second half of the categorize flow: read the open proposal back, then
// either commit the rows the user kept or throw the whole thing away.

export interface PendingProposal {
  opId: string
  changes: ProposedChange[]
  createdAt: string
}

// The op stores only taskId/prior/next — enough to apply and to undo, but not
// enough to RENDER. Titles are joined back on read rather than denormalised
// into the op, because a title the user edited between proposing and reviewing
// should show as it is now, not as it was when the model saw it.
async function describe(op: TaskBulkOpDoc, userId: string): Promise<PendingProposal> {
  const ids = op.entries.map((e) => e.taskId)
  const tasks = await Task.find({ _id: { $in: ids }, userId, ...notDeleted() })
  const byId = new Map(tasks.map((t) => [String(t._id), t]))

  const changes: ProposedChange[] = op.entries.flatMap((entry) => {
    const task = byId.get(String(entry.taskId))
    // Deleted or trashed since the proposal was made — drop it rather than
    // offering to refile something that is no longer in the list.
    if (!task) return []
    const toDomain = (entry.next.domain as Domain | undefined) ?? task.domain
    const nextTags = (entry.next.tags as string[] | undefined) ?? task.tags
    return [
      {
        taskId: String(entry.taskId),
        title: task.title,
        fromDomain: task.domain,
        toDomain,
        addedTags: nextTags.filter((t) => !task.tags.includes(t)),
        confidence: (entry.confidence ?? 'low') as ConfidenceBucket,
        reason: entry.reason ?? '',
      },
    ]
  })

  return {
    opId: String(op._id),
    changes,
    createdAt: (op.get('createdAt') as Date).toISOString(),
  }
}

/** The user's one open proposal, if any. */
export async function getPendingProposal(userId: string): Promise<PendingProposal | null> {
  const op = await TaskBulkOp.findOne({ userId, kind: 'categorize', status: 'proposed' })
  return op ? describe(op, userId) : null
}

async function loadProposed(userId: string, opId: string): Promise<TaskBulkOpDoc> {
  if (!Types.ObjectId.isValid(opId)) {
    throw NotFound('proposal_not_found', 'That suggestion has expired.')
  }
  const op = await TaskBulkOp.findOne({ _id: opId, userId, kind: 'categorize' })
  if (!op || op.status !== 'proposed') {
    throw NotFound('proposal_not_found', 'That suggestion has expired.')
  }
  return op
}

export interface ApplyResult {
  applied: number
  undoToken: string | null
}

// Commit the accepted subset.
//
// The op's `entries` are NARROWED to what the user kept before anything is
// written. This is the load-bearing step: undo replays `entries[].prior`, so
// leaving a rejected row in the record would have undo "restore" a matter that
// was never touched — quietly reverting a domain the user had deliberately set
// on that row instead.
export async function applyProposal(
  userId: string,
  opId: string,
  acceptedTaskIds: string[],
  now: Date = new Date(),
): Promise<ApplyResult> {
  const op = await loadProposed(userId, opId)

  const accepted = new Set(acceptedTaskIds)
  const kept = op.entries.filter((e) => accepted.has(String(e.taskId)))

  if (kept.length === 0) {
    op.status = 'discarded'
    await op.save()
    return { applied: 0, undoToken: null }
  }

  op.set('entries', kept)
  op.status = 'applied'
  op.appliedAt = now
  await op.save()

  await Task.bulkWrite(
    kept.map((e) => ({
      updateOne: {
        // Re-asserting the live filter closes the window where the matter was
        // trashed while the proposal sat on screen.
        filter: { _id: e.taskId, userId, ...notDeleted() },
        update: toMongoOps(e.next),
      },
    })),
    { ordered: false },
  )

  return { applied: kept.length, undoToken: String(op._id) }
}

export async function discardProposal(userId: string, opId: string): Promise<void> {
  const op = await loadProposed(userId, opId)
  op.status = 'discarded'
  await op.save()
}
