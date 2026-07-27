import { z } from 'zod'
import { type Domain } from '../../../models/User'
import { TASK_PRIORITIES, type TaskPriority } from '../../../models/Task'
import {
  CONFIDENCE_BUCKETS,
  DOCUMENT_TYPES,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_SUBTITLE_MAX,
  DOCUMENT_ISSUER_MAX,
  type ConfidenceBucket,
  type DocumentType,
} from '../../../models/ScannedDocument'

// The shared contract for "document page image(s) -> structured task
// candidates". Unlike voiceCore, there is no auto-save / clarify lane here —
// product decision is every scan candidate is held for explicit user
// confirmation before it becomes a Task, so the model's confidence is
// informational (shown on the review card) and never gates persistence.

export const MAX_EXTRACTED_CANDIDATES = 15

export { CONFIDENCE_BUCKETS, DOCUMENT_TYPES, DOCUMENT_TITLE_MAX, DOCUMENT_SUBTITLE_MAX, DOCUMENT_ISSUER_MAX }
export type { ConfidenceBucket, DocumentType }

export const ModelCandidateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  domain: z.string().trim().toLowerCase(),
  confidence: z.enum(CONFIDENCE_BUCKETS).catch('low'),
  priority: z.enum(TASK_PRIORITIES).nullish(),
  dueAt: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  sourcePage: z.number().int().min(1).nullish(),
})
export type ModelCandidate = z.infer<typeof ModelCandidateSchema>

// Every document-level field is `.nullish()` on purpose: a model that omits
// one must degrade the row's copy, never fail the whole parse and lose the
// candidates alongside it. Lengths are clamped in the hardening step rather
// than rejected here for the same reason.
export const ModelDocumentExtractionSchema = z.object({
  documentSummary: z.string().max(2000).nullish(),
  documentType: z.string().trim().toLowerCase().nullish(),
  documentTitle: z.string().max(400).nullish(),
  documentSubtitle: z.string().max(600).nullish(),
  issuer: z.string().max(400).nullish(),
  candidates: z.array(ModelCandidateSchema).max(MAX_EXTRACTED_CANDIDATES).catch([]),
})

// Hardened candidate the extractor returns (domain validated, date resolved).
// No key yet — the worker assigns a document-scoped key so a retry/reclaim
// stays idempotent.
export interface DraftCandidate {
  title: string
  domain: Domain
  priority: TaskPriority
  confidence: ConfidenceBucket
  dueAt?: Date
  notes?: string
  sourcePage?: number
}

export interface ExtractedCandidate extends DraftCandidate {
  key: string
}
