import { Types } from 'mongoose'
import { Task, type TaskDoc } from '../../../models/Task'
import type { ExtractedCandidate } from './contract'

interface PersistArgs {
  userId: Types.ObjectId | string
  documentId: Types.ObjectId | string
  items: ExtractedCandidate[]
}

// Idempotent persistence: upsert one Task per (document, candidate key). Only
// called from the confirm/review step — nothing here runs until the user has
// explicitly accepted a candidate, per the "draft for confirmation" decision.
// The partial unique index on {userId, sourceDocumentId, sourceTaskKey}
// (mirroring the voice-note one) guarantees a retry/duplicate confirm is a
// no-op, not a duplicate task.
export async function persistTasksFromCandidates(args: PersistArgs): Promise<TaskDoc[]> {
  if (args.items.length === 0) return []

  const userId = new Types.ObjectId(args.userId)
  const documentId = new Types.ObjectId(args.documentId)
  const keys = args.items.map((i) => i.key)

  await Task.bulkWrite(
    args.items.map((it) => ({
      updateOne: {
        filter: { userId, sourceDocumentId: documentId, sourceTaskKey: it.key },
        update: {
          $setOnInsert: {
            userId,
            title: it.title,
            domain: it.domain,
            priority: it.priority,
            status: 'open',
            sourceDocumentId: documentId,
            sourceTaskKey: it.key,
            confidence: it.confidence,
            ...(it.dueAt ? { dueAt: it.dueAt } : {}),
            ...(it.notes ? { notes: it.notes } : {}),
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  )

  const docs = await Task.find({
    userId,
    sourceDocumentId: documentId,
    sourceTaskKey: { $in: keys },
  })
  const byKey = new Map(docs.map((d) => [d.sourceTaskKey, d]))
  return args.items.map((i) => byKey.get(i.key)).filter((d): d is TaskDoc => Boolean(d))
}
