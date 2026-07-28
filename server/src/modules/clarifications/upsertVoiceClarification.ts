import { Types } from 'mongoose'

import {
  Clarification,
  type ClarificationCost,
  type ClarificationKind,
} from '../../models/Clarification'
import type { Domain } from '../../models/User'
import type { TaskPriority } from '../../models/Task'

// Idempotent creation of a VOICE-born held item, keyed by the note-scoped item
// key. A worker reclaim/retry that re-runs this is a no-op for an already-held
// item — the partial unique index on {userId, sourceKey} plus $setOnInsert
// guarantees it, and a hold the user already RESOLVED is never resurrected
// (matched but not re-opened). Mirrors persistTasksFromItems' upsert pattern.

export interface UpsertVoiceClarificationInput {
  userId: Types.ObjectId | string
  // The Task this question is about — created before the question, so the item
  // is visible in Matters from the moment it's captured.
  taskId: Types.ObjectId | string
  // The note-scoped item key (from makeItemKey) — the idempotency anchor.
  sourceKey: string
  draft: {
    title: string
    domain: Domain
    priority?: TaskPriority
    notes?: string
    tags?: string[]
    dueAt?: Date
  }
  question: string
  kind: ClarificationKind
  costOfWrong: ClarificationCost
  options: { label: string; dueAt?: Date; title?: string; notes?: string }[]
}

export async function upsertVoiceClarification(
  input: UpsertVoiceClarificationInput,
): Promise<{ clarificationId: string; title: string }> {
  const userId = new Types.ObjectId(input.userId)
  const doc = await Clarification.findOneAndUpdate(
    { userId, sourceKey: input.sourceKey },
    {
      $setOnInsert: {
        userId,
        taskId: new Types.ObjectId(input.taskId),
        sourceKey: input.sourceKey,
        status: 'open',
        draft: {
          title: input.draft.title,
          domain: input.draft.domain,
          priority: input.draft.priority ?? 'normal',
          notes: input.draft.notes,
          tags: input.draft.tags ?? [],
          dueAt: input.draft.dueAt,
        },
        question: input.question,
        kind: input.kind,
        costOfWrong: input.costOfWrong,
        options: input.options,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  return { clarificationId: doc.id, title: doc.draft.title }
}
