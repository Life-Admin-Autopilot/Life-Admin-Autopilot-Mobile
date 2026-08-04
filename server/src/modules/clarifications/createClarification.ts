import { Types } from 'mongoose'

import { Clarification } from '../../models/Clarification'
import type { Domain } from '../../models/User'
import type { TaskPriority } from '../../models/Task'
import type { ClarificationCost, ClarificationKind } from '../../models/Clarification'
import { clampSourceText } from './sourceQuote'

// Persist one held item. Called from the `holdForClarification` tool dispatch
// (toolRunner) with dates already normalized to Date objects, so this stays a
// thin, side-effect-only writer. Returns just enough for the tool result that
// flows back to the model ("I held it as <title>") and the SSE event.

export interface CreateClarificationInput {
  userId: string
  // The Task this question is about — created by the caller BEFORE the
  // question, so the item is never withheld from the user.
  taskId: Types.ObjectId | string
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
  /** The message this question came out of, verbatim — shown back on the card. */
  sourceText?: string
}

export async function createClarification(
  input: CreateClarificationInput,
): Promise<{ clarificationId: string; title: string }> {
  const doc = await Clarification.create({
    userId: input.userId,
    taskId: new Types.ObjectId(input.taskId),
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
    sourceText: clampSourceText(input.sourceText),
  })
  return { clarificationId: doc.id, title: doc.draft.title }
}
