import { Types } from 'mongoose'

import { Clarification } from '../../models/Clarification'
import type { Domain } from '../../models/User'

// Close out held questions whose task is going away.
//
// A question is ABOUT a task; once the task is deleted there is nothing left to
// clarify, so leaving it open would strand a prompt the user can never
// meaningfully answer. Now that Clarification carries a real taskId this is a
// genuine cascade — before, an open row referenced nothing, which is exactly
// why "delete all my tasks" left the questions standing on the dashboard.

export interface DropClarificationsForTasksInput {
  userId: string
  taskIds: (Types.ObjectId | string)[]
}

// Per-task cascade — the delete path for one or many specific tasks.
export async function dropClarificationsForTasks(
  input: DropClarificationsForTasksInput,
): Promise<{ droppedCount: number }> {
  if (input.taskIds.length === 0) return { droppedCount: 0 }
  const result = await Clarification.updateMany(
    {
      userId: input.userId,
      status: 'open',
      taskId: { $in: input.taskIds.map((id) => new Types.ObjectId(id)) },
    },
    { $set: { status: 'dropped', resolvedAt: new Date() } },
  )
  return { droppedCount: result.modifiedCount }
}

export interface DropOpenClarificationsInput {
  userId: string
  domain?: Domain
}

// Blanket drop for a "clear everything" wipe. Scoped by draft.domain when the
// wipe was domain-scoped. A status-scoped wipe deliberately drops nothing:
// `status` describes a task's lifecycle and the per-task cascade above already
// covers whatever that wipe actually deleted.
export async function dropOpenClarifications(
  input: DropOpenClarificationsInput,
): Promise<{ droppedCount: number }> {
  const result = await Clarification.updateMany(
    {
      userId: input.userId,
      status: 'open',
      ...(input.domain ? { 'draft.domain': input.domain } : {}),
    },
    { $set: { status: 'dropped', resolvedAt: new Date() } },
  )
  return { droppedCount: result.modifiedCount }
}
