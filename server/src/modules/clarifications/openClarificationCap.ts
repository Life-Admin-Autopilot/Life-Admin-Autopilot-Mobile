import { Clarification } from '../../models/Clarification'

// How many held items a user may have open at once.
//
// The voice path can't runaway — a unique partial index on (userId, sourceKey)
// makes each note-scoped item idempotent. A CHAT-born hold carries no
// sourceKey, so `createClarification` is a bare create() with nothing stopping
// the same fuzzy item being held again every turn, forever.
//
// Past the cap the caller degrades to creating the task outright with the
// model's best-guess date. A slightly-wrong but VISIBLE task beats a question
// the user never sees, and it's the direction the whole feature is moving.
export const MAX_OPEN_CLARIFICATIONS = 12

export async function countOpenClarifications(userId: string): Promise<number> {
  return Clarification.countDocuments({ userId, status: 'open' })
}

export async function isAtOpenClarificationCap(userId: string): Promise<boolean> {
  return (await countOpenClarifications(userId)) >= MAX_OPEN_CLARIFICATIONS
}
