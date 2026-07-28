import { z } from 'zod'
import { type Domain } from '../../../models/User'
import { TASK_PRIORITIES, type TaskEstimate, type TaskPriority } from '../../../models/Task'
import {
  CONFIDENCE_BUCKETS,
  REVIEW_REASONS,
  type ConfidenceBucket,
  type ReviewReason,
} from '../../../models/VoiceNote'
import {
  CLARIFICATION_COSTS,
  CLARIFICATION_KINDS,
  type ClarificationCost,
  type ClarificationKind,
} from '../../../models/Clarification'

// The shared contract for "transcript -> structured tasks". Both the async
// capture worker and the synchronous chat-voice path produce DraftItem[]; the
// worker then keys them into ExtractedItem[] for persistence + review.

export const MAX_EXTRACTED_ITEMS = 25

// Re-export the enums so extractor/gate/dedupe import from one place.
export { CONFIDENCE_BUCKETS, REVIEW_REASONS, CLARIFICATION_KINDS, CLARIFICATION_COSTS }
export type { ConfidenceBucket, ReviewReason, ClarificationKind, ClarificationCost }

// What the model is asked to emit per task (before server-side hardening).
// Tolerant: nullish on optionals because Gemini structured-output emits null
// rather than omitting keys.
// A suggested answer the model proposes for a clarifiable item. dueAt is a
// best-guess ISO string the server re-normalizes; nullish because Gemini emits
// null rather than omitting.
export const ModelClarifyOptionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  dueAt: z.string().max(60).nullish(),
})

export const ModelTaskSchema = z.object({
  title: z.string().trim().min(1).max(240),
  domain: z.string().trim().toLowerCase(),
  confidence: z.enum(CONFIDENCE_BUCKETS).catch('low'),
  reviewReason: z.enum(REVIEW_REASONS).catch('ambiguous_intent'),
  reasons: z.array(z.string().max(200)).max(4).nullish(),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  // Bucket labels, not integers — the response schema constrains these to
  // ESTIMATE_BUCKET_LABELS, but a number is accepted here too so a model that
  // ignores the string typing is snapped rather than rejected.
  estimateMinMinutes: z.union([z.string().max(8), z.number()]).nullish(),
  estimateMaxMinutes: z.union([z.string().max(8), z.number()]).nullish(),
  dueRaw: z.string().max(200).nullish(),
  dueAt: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  // Optional "ask, don't guess" block. When set, the worker turns this item
  // into a held Clarification (home banner → /clarify slider) instead of an
  // auto-saved task or a silent review item.
  clarifyQuestion: z.string().trim().max(300).nullish(),
  clarifyKind: z.enum(CLARIFICATION_KINDS).nullish(),
  clarifyCost: z.enum(CLARIFICATION_COSTS).nullish(),
  clarifyOptions: z.array(ModelClarifyOptionSchema).max(4).nullish(),
})
export type ModelTask = z.infer<typeof ModelTaskSchema>

export const ModelExtractionSchema = z.object({
  // Unbounded on purpose — the response schema no longer caps the array (it
  // overflowed Gemini's constraint compiler), and `.max()` ahead of `.catch([])`
  // would turn one item over the cap into zero tasks. extractItems slices to
  // MAX_EXTRACTED_ITEMS after parsing.
  tasks: z.array(ModelTaskSchema).catch([]),
})

// A clarifiable hold the extractor surfaced from a voice item: the question to
// ask + pre-resolved option dates (already normalized to absolute Date). The
// worker upserts this into a Clarification keyed by the item's note-scoped key.
export interface DraftClarification {
  question: string
  kind: ClarificationKind
  // Whether a wrong guess is cheap to fix (reschedule a nudge) or expensive
  // (miss a bill / flight / court date). Decides whether the task created
  // alongside this question gets a live reminder or a withheld one.
  costOfWrong: ClarificationCost
  options: { label: string; dueAt?: Date }[]
}

// Hardened item the extractor returns (domain validated, date resolved). No
// key yet — the worker assigns a note-scoped key so retries stay idempotent.
export interface DraftItem {
  title: string
  domain: Domain
  priority: TaskPriority
  confidence: ConfidenceBucket
  reviewReason: ReviewReason
  reasons: string[]
  // Bucketed time window for the task itself. Absent when the model gave
  // nothing usable — an absent estimate is honest, an invented one is not.
  estimate?: TaskEstimate
  dueRaw?: string
  dueAt?: Date
  notes?: string
  // Present when this item should be HELD as a question rather than saved.
  clarification?: DraftClarification
}

// A DraftItem that has been assigned a stable per-(note,item) key.
export interface ExtractedItem extends DraftItem {
  key: string
}
