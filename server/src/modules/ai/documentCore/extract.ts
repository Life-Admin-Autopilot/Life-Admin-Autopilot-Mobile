import { Type, type Content } from '@google/genai'

import { env } from '../../../env'
import { logger } from '../../../logger'
import { DOMAINS, type Domain } from '../../../models/User'
import { TASK_PRIORITIES, type TaskPriority } from '../../../models/Task'
import { getGeminiClient } from '../provider/geminiClient'
import { normalizeLocalIso, STRICT_DATETIME_RE } from '../timeNormalize'
import { withGeminiRetry } from '../voiceCore/geminiRetry'
import {
  ModelDocumentExtractionSchema,
  MAX_EXTRACTED_CANDIDATES,
  CONFIDENCE_BUCKETS,
  type ModelCandidate,
  type DraftCandidate,
  type ConfidenceBucket,
} from './contract'

// Scanned document -> structured task candidates, in one Gemini vision call.
// Gemini natively understands multi-page PDFs (and images) sent as a single
// inlineData part — no page-by-page rasterization needed, same inlineData
// pattern audioTranscriber.ts uses for audio.
//
// Uses structured output (responseSchema), same posture as voiceCore/extract —
// the model proposes, the server hardens (domain validation, date resolution).
// No auto-save gate: every candidate returned here is held for user review by
// product decision, so there is no confidence threshold to tune here.

const SYSTEM = `
You read a scanned document (which may have multiple pages) and extract
actionable to-do candidates a personal assistant app should offer the user — bills to pay,
appointments to keep, renewals/expirations, deadlines, forms to submit. Ignore boilerplate,
ads, and anything with no action for the user.

EMIT ONE CANDIDATE PER DISCRETE ACTIONABLE ITEM, up to ${MAX_EXTRACTED_CANDIDATES}. A single
document can hold more than one (e.g. an insurance renewal letter naming both a payment due
date and a policy-renewal deadline) — emit each separately. If the document has no actionable
item, return an empty candidates array.

PER CANDIDATE, SET:
- title: short imperative title in the document's own language ("Pay electricity bill",
  "Renew car insurance").
- domain: the single best of health, home, car, finance, family, pets.
- priority: low | normal | high | urgent — from due-date proximity and stated urgency/penalty
  language ("final notice", "overdue" = urgent; a routine renewal months out = low).
- dueAt: your best resolution of any stated due/deadline date to ISO 8601 with a literal T and
  an explicit UTC offset (e.g. "2026-06-15T09:00:00+00:00"). null if no date is stated or you
  cannot resolve it confidently — do not guess a date that is not actually on the page.
- confidence: high | medium | low — your certainty this is a real, correctly-read candidate.
  Low legibility, a partially obscured field, or genuine ambiguity about what's being asked
  should lower this. Confidence is shown to the user on the review card; it does not affect
  whether the item is saved (every candidate is reviewed by the user regardless).
- notes: an "AI overview" of this specific item — ONE short natural-language SENTENCE in the
  document's own language, prose, not a raw field dump. Weave in the key figures/reference
  numbers/dates that matter, the way you'd explain it to someone out loud. Good:
  "Electricity bill for $142.37, account 88213-4471, due July 30." Bad: "Account Number:
  88213-4471, Amount Due: $142.37" (that's a label dump, not a sentence). ≤2000 chars, or null
  if the title already says everything there is to say.
- sourcePage: 1-based page number (of the images provided, in order) the candidate came from.

documentSummary: a one-to-two-sentence AI overview of the document as a whole — what kind of
document it is, who it's from, and the single most important fact (total amount, main deadline,
etc.) if there is one. Written in prose, for display as the document's own overview. Null if you
cannot tell. Example: "An electricity bill from City Power for the March cycle, totaling
$142.37 and due July 30."

Return ONLY the JSON object matching the schema. No prose.
`.trim()

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    documentSummary: { type: Type.STRING, nullable: true },
    candidates: {
      type: Type.ARRAY,
      maxItems: String(MAX_EXTRACTED_CANDIDATES),
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          domain: { type: Type.STRING, enum: [...DOMAINS] },
          priority: { type: Type.STRING, enum: [...TASK_PRIORITIES] },
          confidence: { type: Type.STRING, enum: [...CONFIDENCE_BUCKETS] },
          dueAt: { type: Type.STRING, nullable: true },
          notes: { type: Type.STRING, nullable: true },
          sourcePage: { type: Type.INTEGER, nullable: true },
        },
        required: ['title', 'domain', 'confidence'],
        propertyOrdering: [
          'title',
          'domain',
          'priority',
          'confidence',
          'dueAt',
          'notes',
          'sourcePage',
        ],
      },
    },
  },
  required: ['candidates'],
}

export interface ExtractDocumentArgs {
  bytes: Buffer
  mimeType: string
  timezone?: string
}

export interface DocumentExtractionResult {
  documentSummary?: string
  candidates: DraftCandidate[]
}

export async function extractDocumentCandidates(
  args: ExtractDocumentArgs,
): Promise<DocumentExtractionResult> {
  const client = getGeminiClient()
  const userTurn: Content = {
    role: 'user',
    parts: [
      { inlineData: { mimeType: args.mimeType, data: args.bytes.toString('base64') } },
      { text: 'Extract actionable candidates from this document.' },
    ],
  }

  const response = await withGeminiRetry(
    () =>
      client.models.generateContent({
        model: env().GEMINI_STRONG_MODEL,
        contents: [userTurn],
        config: {
          systemInstruction: SYSTEM,
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0,
        },
      }),
    'document-extract',
  )

  const text = (response.text ?? '').trim()
  if (!text) return { candidates: [] }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'document-extract:invalid-json')
    return { candidates: [] }
  }

  const parsed = ModelDocumentExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'document-extract:schema-mismatch')
    return { candidates: [] }
  }

  const candidates = parsed.data.candidates
    .slice(0, MAX_EXTRACTED_CANDIDATES)
    .map((c) => hardenCandidate(c, args.timezone))
    .filter((c): c is DraftCandidate => c !== null)

  return {
    documentSummary: parsed.data.documentSummary?.trim() || undefined,
    candidates,
  }
}

function hardenCandidate(c: ModelCandidate, timezone: string | undefined): DraftCandidate | null {
  const title = c.title.trim().slice(0, 240)
  if (!title) return null

  let domain = c.domain as Domain
  let confidence: ConfidenceBucket = c.confidence
  // Never drop an unknown-domain candidate — park it in 'home' with lowered
  // confidence so the user reassigns it on the review card. A lost candidate
  // is the worst outcome.
  if (!(DOMAINS as readonly string[]).includes(domain)) {
    domain = 'home'
    confidence = 'low'
  }

  let dueAt: Date | undefined
  if (c.dueAt && STRICT_DATETIME_RE.test(c.dueAt)) {
    try {
      dueAt = normalizeLocalIso(c.dueAt, timezone)
    } catch {
      dueAt = undefined
    }
  }

  const priority: TaskPriority =
    c.priority && (TASK_PRIORITIES as readonly string[]).includes(c.priority) ? c.priority : 'normal'

  return {
    title,
    domain,
    priority,
    confidence,
    dueAt,
    notes: c.notes?.trim() || undefined,
    sourcePage: c.sourcePage ?? undefined,
  }
}
