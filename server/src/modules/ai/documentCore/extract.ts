import { Type, type Content } from '@google/genai'

import { env } from '../../../env'
import { logger } from '../../../logger'
import { DOMAINS, type Domain } from '../../../models/User'
import {
  ESTIMATE_BUCKETS,
  ESTIMATE_BUCKET_LABELS,
  TASK_PRIORITIES,
  normalizeEstimate,
  type TaskPriority,
} from '../../../models/Task'
import { getGeminiClient } from '../provider/geminiClient'
import { extractionLanguageRule, type AiLocale } from '../promptLanguage'
import { normalizeLocalIso, STRICT_DATETIME_RE } from '../timeNormalize'
import { withGeminiRetry } from '../voiceCore/geminiRetry'
import {
  ModelDocumentExtractionSchema,
  MAX_EXTRACTED_CANDIDATES,
  CONFIDENCE_BUCKETS,
  DOCUMENT_TYPES,
  DOCUMENT_TITLE_MAX,
  DOCUMENT_SUBTITLE_MAX,
  DOCUMENT_ISSUER_MAX,
  type ModelCandidate,
  type DraftCandidate,
  type ConfidenceBucket,
  type DocumentType,
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

const SYSTEM_BASE = `
You read a scanned document (which may have multiple pages) and extract
actionable to-do candidates a personal assistant app should offer the user — bills to pay,
appointments to keep, renewals/expirations, deadlines, forms to submit. Ignore boilerplate,
ads, and anything with no action for the user.

EMIT ONE CANDIDATE PER DISCRETE ACTIONABLE ITEM, up to ${MAX_EXTRACTED_CANDIDATES}. A single
document can hold more than one (e.g. an insurance renewal letter naming both a payment due
date and a policy-renewal deadline) — emit each separately. If the document has no actionable
item, return an empty candidates array.

PER CANDIDATE, SET:
- title: short imperative title ("Pay electricity bill", "Renew car insurance"). See LANGUAGE
  at the end — this is written for the reader, not copied from the page.
- domain: the single best of health, home, car, finance, family, pets.
- priority: low | normal | high | urgent — from due-date proximity and stated urgency/penalty
  language ("final notice", "overdue" = urgent; a routine renewal months out = low).
- estimateMinMinutes / estimateMaxMinutes: how long DOING this will take, as a range in minutes.
  Both MUST be one of exactly these values: ${ESTIMATE_BUCKETS.join(', ')}. Nothing between them
  exists — there is no "23 minutes", because nobody can know that. max must be >= min; use the
  same value twice when the job is tight ("5" and "5"). Estimate the DOING, never the waiting or
  the amount of money involved: paying a $2,400 bill online takes the same ten minutes as paying
  a $24 one, and "attend the appointment on the 14th" is the travel-and-visit, not the two weeks
  until it. When you genuinely cannot tell, give a WIDE range rather than a confident narrow one.
- dueAt: your best resolution of any stated due/deadline date to ISO 8601 with a literal T and
  an explicit UTC offset (e.g. "2026-06-15T09:00:00+00:00"). null if no date is stated or you
  cannot resolve it confidently — do not guess a date that is not actually on the page.
- confidence: high | medium | low — your certainty this is a real, correctly-read candidate.
  Low legibility, a partially obscured field, or genuine ambiguity about what's being asked
  should lower this. Confidence is shown to the user on the review card; it does not affect
  whether the item is saved (every candidate is reviewed by the user regardless).
- notes: an "AI overview" of this specific item — ONE short natural-language SENTENCE, prose,
  not a raw field dump. Weave in the key figures/reference
  numbers/dates that matter, the way you'd explain it to someone out loud. Good:
  "Electricity bill for $142.37, account 88213-4471, due July 30." Bad: "Account Number:
  88213-4471, Amount Due: $142.37" (that's a label dump, not a sentence). ≤2000 chars, or null
  if the title already says everything there is to say.
- sourcePage: 1-based page number (of the images provided, in order) the candidate came from.

ALSO DESCRIBE THE DOCUMENT ITSELF. These five fields describe the whole document, not any one
candidate, and they are what the user sees in their document list — set them even when there
are no candidates at all.

- documentType: exactly one of ${DOCUMENT_TYPES.join(', ')}. Classify what the document IS, not
  what it asks of you — a bill you have already paid is still "bill", and a letter that happens
  to demand payment is still "letter" if it isn't itemized like an invoice. Use "other" honestly
  when nothing fits; a confidently wrong type is worse than a generic one.
- documentTitle: a SHORT NOUN PHRASE naming the document, ≤${DOCUMENT_TITLE_MAX} characters.
  No sentence punctuation, no leading article, not a sentence.
  Good: "Electricity bill". "Car insurance renewal". "Blood test results". Bad: "This is an
  electricity bill from City Power" (that's a sentence). Do NOT put the sender's name in here —
  it belongs in issuer.
- documentSubtitle: ONE line, ≤${DOCUMENT_SUBTITLE_MAX} characters, carrying the most useful
  concrete facts — amount, deadline, reference number, period covered. It is displayed on one
  line and CUT OFF at the end if it overflows, so put the single most important thing FIRST and
  the least important last. Good: "Due July 30 · $142.37 · account 88213-4471". Bad: "This
  document, which was issued by the utility company, concerns..." (the useful part is past the
  cut). Null if the title already says everything.
- issuer: the organization or person the document came from, verbatim as printed
  ("City Power", "Dr. Amira Hassan"), ≤${DOCUMENT_ISSUER_MAX} characters. Null if not stated.
- documentSummary: a one-to-two-sentence overview in prose — what kind of document it is, who
  it's from, and the single most important fact if there is one. This one is shown on the
  document's detail screen where there is room for a full sentence, so it may repeat what the
  title and subtitle say. Null if you cannot tell. Example: "An electricity bill from City Power
  for the March cycle, totaling $142.37 and due July 30."

Return ONLY the JSON object matching the schema. No prose.
`.trim()

// `issuer` is the one field the language rule must NOT touch: it is defined as
// "verbatim as printed", and it is what the user matches against the letterhead
// in front of them. The preserve clause inside the shared rule already protects
// it (an organisation's name), and this repeats it because the field is the most
// tempting one to translate — "City Power" reads like two ordinary words.
function systemFor(locale: AiLocale): string {
  return [
    SYSTEM_BASE,
    extractionLanguageRule(locale),
    '`issuer` is copied from the page exactly as printed, never translated.',
  ].join('\n\n')
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    documentSummary: { type: Type.STRING, nullable: true },
    documentType: { type: Type.STRING, enum: [...DOCUMENT_TYPES], nullable: true },
    documentTitle: { type: Type.STRING, nullable: true },
    documentSubtitle: { type: Type.STRING, nullable: true },
    issuer: { type: Type.STRING, nullable: true },
    candidates: {
      type: Type.ARRAY,
      // No maxItems on purpose. Gemini compiles responseSchema into a decoding
      // constraint and unrolls a bounded array once per allowed element, so
      // `maxItems` multiplies the item's state count by that bound — with this
      // many enum-constrained fields, 15 copies overflows the serving limit and
      // every scan 400s with "too many states for serving". The cap is enforced
      // where it actually matters anyway: the prompt asks for it and the parse
      // below slices to MAX_EXTRACTED_CANDIDATES.
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          domain: { type: Type.STRING, enum: [...DOMAINS] },
          priority: { type: Type.STRING, enum: [...TASK_PRIORITIES] },
          confidence: { type: Type.STRING, enum: [...CONFIDENCE_BUCKETS] },
          // STRING because Gemini's enum constraint only applies to strings —
          // an INTEGER field would let "23" through, and the whole point of the
          // ladder is that 23 does not exist.
          estimateMinMinutes: { type: Type.STRING, enum: ESTIMATE_BUCKET_LABELS },
          estimateMaxMinutes: { type: Type.STRING, enum: ESTIMATE_BUCKET_LABELS },
          dueAt: { type: Type.STRING, nullable: true },
          notes: { type: Type.STRING, nullable: true },
          sourcePage: { type: Type.INTEGER, nullable: true },
        },
        // Estimates are required so the model cannot quietly skip the judgment
        // — Gemini drops optional fields it deems inferrable.
        required: ['title', 'domain', 'confidence', 'estimateMinMinutes', 'estimateMaxMinutes'],
        propertyOrdering: [
          'title',
          'domain',
          'priority',
          'confidence',
          'estimateMinMinutes',
          'estimateMaxMinutes',
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
  /** Required so a new call site cannot silently extract into the wrong language. */
  locale: AiLocale
}

export interface DocumentExtractionResult {
  documentSummary?: string
  documentType?: DocumentType
  documentTitle?: string
  documentSubtitle?: string
  issuer?: string
  candidates: DraftCandidate[]
}

// Trim, collapse whitespace, clamp. A row-copy field that arrives as a
// paragraph is a layout bug waiting to happen, and an empty string is not the
// same as "absent" downstream — the row falls back only on undefined.
function clampCopy(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized ? normalized.slice(0, max) : undefined
}

function hardenDocumentType(value: string | null | undefined): DocumentType | undefined {
  if (!value) return undefined
  // An unrecognized type falls back to 'other' rather than undefined: the model
  // did classify the document, it just used a word outside our set, and 'other'
  // is a truer record of that than "never classified".
  return (DOCUMENT_TYPES as readonly string[]).includes(value) ? (value as DocumentType) : 'other'
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
          systemInstruction: systemFor(args.locale),
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
    documentType: hardenDocumentType(parsed.data.documentType),
    documentTitle: clampCopy(parsed.data.documentTitle, DOCUMENT_TITLE_MAX),
    documentSubtitle: clampCopy(parsed.data.documentSubtitle, DOCUMENT_SUBTITLE_MAX),
    issuer: clampCopy(parsed.data.issuer, DOCUMENT_ISSUER_MAX),
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
    // Snapped and ordered here even though the response schema constrained it —
    // a schema the provider may relax under load is not an enforcement mechanism.
    estimate: normalizeEstimate(
      { minMinutes: c.estimateMinMinutes, maxMinutes: c.estimateMaxMinutes },
      'ai',
    ),
    dueAt,
    notes: c.notes?.trim() || undefined,
    sourcePage: c.sourcePage ?? undefined,
  }
}
