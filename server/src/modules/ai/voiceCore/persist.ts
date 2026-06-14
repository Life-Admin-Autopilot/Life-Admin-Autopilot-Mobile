import { Types } from 'mongoose'
import { Task, type TaskDoc } from '../../../models/Task'
import type { ExtractedItem } from './contract'

interface PersistArgs {
  userId: Types.ObjectId | string
  voiceNoteId: Types.ObjectId | string
  items: ExtractedItem[]
}

// Idempotent persistence: upsert one Task per (note, item key). A worker retry
// or job reclaim re-running this is a no-op for already-created tasks — the
// partial unique index on {userId, sourceVoiceNoteId, sourceTaskKey} guarantees
// it. Returns the resulting Task docs (created or pre-existing), in item order.
export async function persistTasksFromItems(args: PersistArgs): Promise<TaskDoc[]> {
  if (args.items.length === 0) return []

  const userId = new Types.ObjectId(args.userId)
  const voiceNoteId = new Types.ObjectId(args.voiceNoteId)
  const keys = args.items.map((i) => i.key)

  await Task.bulkWrite(
    args.items.map((it) => ({
      updateOne: {
        filter: { userId, sourceVoiceNoteId: voiceNoteId, sourceTaskKey: it.key },
        update: {
          $setOnInsert: {
            userId,
            title: it.title,
            domain: it.domain,
            priority: it.priority,
            status: 'open',
            sourceVoiceNoteId: voiceNoteId,
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

  const docs = await Task.find({ userId, sourceVoiceNoteId: voiceNoteId, sourceTaskKey: { $in: keys } })
  // Preserve item order (find() is index/insertion ordered, not item-ordered).
  const byKey = new Map(docs.map((d) => [d.sourceTaskKey, d]))
  return args.items.map((i) => byKey.get(i.key)).filter((d): d is TaskDoc => Boolean(d))
}
