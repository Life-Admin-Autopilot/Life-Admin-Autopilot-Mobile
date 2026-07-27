import { Clarification } from '../../models/Clarification'
import type { Domain } from '../../models/User'
import type { TaskPriority } from '../../models/Task'
import type { ClarificationKind } from '../../models/Clarification'

// Persist one held item. Called from the `holdForClarification` tool dispatch
// (toolRunner) with dates already normalized to Date objects, so this stays a
// thin, side-effect-only writer. Returns just enough for the tool result that
// flows back to the model ("I held it as <title>") and the SSE event.

export interface CreateClarificationInput {
  userId: string
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
  options: { label: string; dueAt?: Date; title?: string; notes?: string }[]
}

export async function createClarification(
  input: CreateClarificationInput,
): Promise<{ clarificationId: string; title: string }> {
  const doc = await Clarification.create({
    userId: input.userId,
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
    options: input.options,
  })
  return { clarificationId: doc.id, title: doc.draft.title }
}
