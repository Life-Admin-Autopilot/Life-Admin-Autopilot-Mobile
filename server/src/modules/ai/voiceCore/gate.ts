import { createHash } from 'node:crypto'
import type { DraftItem, ExtractedItem } from './contract'
import { normalizeTitle } from './dedupe'

// The gate — the spine of the feature. Conservative by product decision:
// auto-save ONLY when the model is fully sure (high confidence) AND nothing
// flagged the item (reviewReason 'clear'). Everything else is held for the
// user. A wrong auto-saved task is the worst failure in a personal app, so the
// bar is deliberately high.

export function needsReview(item: Pick<DraftItem, 'confidence' | 'reviewReason'>): boolean {
  return item.confidence !== 'high' || item.reviewReason !== 'clear'
}

export interface GateResult {
  autoSave: ExtractedItem[]
  review: ExtractedItem[]
  // Items the extractor flagged as answerable questions (conflicting date,
  // missing-time-that-matters, unnameable). These become held Clarifications —
  // a distinct lane from `review` (a glance/edit), routed by presence of a
  // `clarification` block, NOT by confidence.
  clarify: ExtractedItem[]
}

// Assign a stable note-scoped key, then split into three lanes. The key is
// deterministic for a given (noteId, position, title) so a worker retry / job
// reclaim re-running persistence upserts to the same Task/Clarification instead
// of creating a duplicate.
export function gateAndKey(noteId: string, items: DraftItem[]): GateResult {
  const autoSave: ExtractedItem[] = []
  const review: ExtractedItem[] = []
  const clarify: ExtractedItem[] = []

  items.forEach((item, index) => {
    const keyed: ExtractedItem = { ...item, key: makeItemKey(noteId, index, item.title) }
    // A clarifiable hold always becomes a question — never auto-saved, never a
    // silent review item — regardless of the model's confidence.
    if (item.clarification) clarify.push(keyed)
    else if (needsReview(item)) review.push(keyed)
    else autoSave.push(keyed)
  })

  return { autoSave, review, clarify }
}

export function makeItemKey(noteId: string, index: number, title: string): string {
  return createHash('sha256')
    .update(`${noteId}|${index}|${normalizeTitle(title)}`)
    .digest('hex')
    .slice(0, 24)
}
