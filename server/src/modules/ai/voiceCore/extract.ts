import { Type, type Content } from '@google/genai'

import { env } from '../../../env'
import { logger } from '../../../logger'
import { DOMAINS, type Domain } from '../../../models/User'
import { TASK_PRIORITIES, type TaskPriority } from '../../../models/Task'
import { getGeminiClient } from '../provider/geminiClient'
import { normalizeLocalIso, STRICT_DATETIME_RE } from '../timeNormalize'
import { withGeminiRetry } from './geminiRetry'
import { dedupeItems } from './dedupe'
import {
  ModelExtractionSchema,
  MAX_EXTRACTED_ITEMS,
  CONFIDENCE_BUCKETS,
  REVIEW_REASONS,
  CLARIFICATION_KINDS,
  type ModelTask,
  type DraftItem,
  type DraftClarification,
  type ReviewReason,
  type ConfidenceBucket,
} from './contract'

// Voice transcript → structured tasks with per-item confidence.
//
// Uses Gemini structured output (responseMimeType JSON + responseSchema), NOT
// function-calling: emitting N tasks each with confidence/reviewReason is far
// more reliable as one validated JSON array than as N parallel tool calls.
// The model proposes; the SERVER decides what's reviewable (date resolution,
// domain validation, dedupe) — verbalized LLM confidence alone is overconfident.

const SYSTEM = `
You convert ONE spoken voice transcript into a list of structured tasks.

EMIT ONE TASK PER DISCRETE INTENT
- A single rambling note can hold many things ("renew insurance, oh and pay the
  water bill before the 15th, and remind me to call the vet"). Emit one task per
  real intent — up to ${MAX_EXTRACTED_ITEMS}.
- If the speaker restates the same thing ("the insurance... yeah the car
  insurance"), emit it ONCE.

PER TASK, SET:
- title: short imperative title in the SPEAKER'S OWN LANGUAGE, verbatim nouns
  ("Renew car insurance", "ادفع فاتورة المياه"). Never translate the title.
- domain: the single best of health, home, car, finance, family, pets.
- priority: low | normal | high | urgent — from urgency cues ("asap"/"urgent" =
  urgent, "important" = high, "whenever"/"no rush" = low, else normal).
- dueRaw: the date/time phrase EXACTLY as spoken ("before the 15th", "next
  Friday", "tomorrow morning"), or null if none was mentioned.
- dueAt: your best resolution of dueRaw to ISO 8601 with a literal T and the
  speaker's explicit offset from the NOW anchor (e.g. "2026-06-15T09:00:00+03:00").
  null if no date was mentioned OR you cannot resolve it confidently.
- confidence: high | medium | low — your certainty this is a real, correct,
  complete task as the user meant it.
    high   = unmistakable intent, clear domain, date (if any) unambiguous.
    medium = mostly clear but something is a little fuzzy.
    low    = you are guessing at the intent, domain, or date.
- reviewReason: why a human should glance at it, or 'clear' if none:
    clear            = nothing to check, safe to save as-is.
    ambiguous_intent = you're unsure what they actually want done.
    vague_date       = a time was implied but you can't pin it ("sometime soon").
    maybe_duplicate  = might be the same as another task in this note.
    incomplete       = the task seems to be missing key info.
    low_asr          = the audio/words were unclear or garbled here.
    unknown_domain   = you can't confidently place it in one of the six domains.
  Be honest: only mark 'clear' + 'high' when you'd stake your reputation on it.
- reasons: 0-4 SHORT plain-language notes shown to the user verbatim, e.g.
  ["Couldn't tell the exact date", "Might be two separate tasks"]. Empty when clear.
- notes: optional longer body (≤2000 chars) in the speaker's language, or null.

ASK INSTEAD OF GUESSING — set a clarification block on an item the user could answer
with a quick tap, instead of silently picking a value. When you set it, the app turns the
item into a question card; do NOT also resolve a dueAt for it. Set it ONLY in these cases:
  1. CONFLICTING / UNSURE date — the speaker floated two dates or wasn't sure ("the 17th or
     the 19th", "I think July? maybe August"). clarifyKind 'date'.
  2. TIME-SENSITIVE task with NO time at all — a real appointment, a bill/rent, a renewal or
     expiry, a hard deadline, or an explicit "remind me to …" spoken with no date. Ask "When
     should I remind you?". clarifyKind 'date'.
  3. UNNAMEABLE — too vague to title ("email that guy about the thing"). clarifyKind 'detail'.
Fields, when (and only when) you set a clarification:
  - clarifyQuestion: the short, warm question in the speaker's language ("The 17th or the
    19th?", "When should I remind you?"). Leave null otherwise.
  - clarifyKind: 'date' | 'detail' | 'choice'. Null otherwise.
  - clarifyOptions: 0-4 suggested answers. For clarifyKind 'date', EACH option MUST carry a
    resolved dueAt (ISO 8601 with the speaker's offset). For 'detail', usually leave empty.
    Labels are short ("The 17th", "Tomorrow morning"). Null/empty otherwise.
DO NOT set a clarification for casual to-dos that simply have no time ("buy bread", "tidy the
garage") — those are normal CLEAR tasks; just emit them with no dueAt. Over-asking is a bug.
When you set a clarification, still give your best provisional title + domain, and set dueAt
to null (the date IS the question).

Return ONLY the JSON object matching the schema. No prose.
`.trim()

// responseSchema mirrors ModelExtractionSchema. Enum-constrained strings keep
// the model on rails; the server still re-validates everything after.
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    tasks: {
      type: Type.ARRAY,
      maxItems: String(MAX_EXTRACTED_ITEMS),
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          domain: { type: Type.STRING, enum: [...DOMAINS] },
          priority: { type: Type.STRING, enum: [...TASK_PRIORITIES] },
          dueRaw: { type: Type.STRING, nullable: true },
          dueAt: { type: Type.STRING, nullable: true },
          confidence: { type: Type.STRING, enum: [...CONFIDENCE_BUCKETS] },
          reviewReason: { type: Type.STRING, enum: [...REVIEW_REASONS] },
          reasons: { type: Type.ARRAY, items: { type: Type.STRING } },
          notes: { type: Type.STRING, nullable: true },
          clarifyQuestion: { type: Type.STRING, nullable: true },
          clarifyKind: { type: Type.STRING, enum: [...CLARIFICATION_KINDS], nullable: true },
          clarifyOptions: {
            type: Type.ARRAY,
            nullable: true,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                dueAt: { type: Type.STRING, nullable: true },
              },
              required: ['label'],
              propertyOrdering: ['label', 'dueAt'],
            },
          },
        },
        required: ['title', 'domain', 'confidence', 'reviewReason'],
        propertyOrdering: [
          'title',
          'domain',
          'priority',
          'dueRaw',
          'dueAt',
          'confidence',
          'reviewReason',
          'reasons',
          'notes',
          'clarifyQuestion',
          'clarifyKind',
          'clarifyOptions',
        ],
      },
    },
  },
  required: ['tasks'],
}

export interface ExtractArgs {
  transcript: string
  timezone?: string
  // Injectable clock for deterministic tests.
  now?: Date
}

export async function extractItems(args: ExtractArgs): Promise<DraftItem[]> {
  if (!args.transcript.trim()) return []

  const client = getGeminiClient()
  const nowIso = formatNow(args.timezone, args.now)
  const userTurn: Content = {
    role: 'user',
    parts: [
      {
        text: ['=== NOW ===', nowIso, '=== TRANSCRIPT ===', args.transcript, '=== END ==='].join('\n'),
      },
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
    'voice-extract',
  )

  const text = (response.text ?? '').trim()
  if (!text) return []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'voice-extract:invalid-json')
    return []
  }

  const parsed = ModelExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'voice-extract:schema-mismatch')
    return []
  }

  const drafts = parsed.data.tasks
    .slice(0, MAX_EXTRACTED_ITEMS)
    .map((t) => hardenItem(t, args.timezone))
    .filter((d): d is DraftItem => d !== null)

  return dedupeItems(drafts)
}

// Server-side hardening — the model proposes, the server decides reviewability.
function hardenItem(t: ModelTask, timezone: string | undefined): DraftItem | null {
  const title = t.title.trim().slice(0, 240)
  if (!title) return null

  let domain = t.domain as Domain
  let confidence: ConfidenceBucket = t.confidence
  let reviewReason: ReviewReason = t.reviewReason

  // Never drop an unknown-domain task — preserve it, park it in 'home', and
  // force review so the user reassigns it. A lost task is the worst outcome.
  if (!(DOMAINS as readonly string[]).includes(domain)) {
    domain = 'home'
    confidence = 'low'
    reviewReason = 'unknown_domain'
  }

  const dueRaw = t.dueRaw?.trim() || undefined
  let dueAt: Date | undefined
  if (t.dueAt && STRICT_DATETIME_RE.test(t.dueAt)) {
    try {
      dueAt = normalizeLocalIso(t.dueAt, timezone)
    } catch {
      dueAt = undefined
    }
  }
  // The speaker named a time but the model couldn't resolve it cleanly → hold.
  if (!dueAt && dueRaw) {
    if (reviewReason === 'clear') reviewReason = 'vague_date'
    if (confidence === 'high') confidence = 'medium'
  }

  const priority: TaskPriority =
    t.priority && (TASK_PRIORITIES as readonly string[]).includes(t.priority)
      ? (t.priority as TaskPriority)
      : 'normal'

  const reasons = (t.reasons ?? [])
    .map((r) => r.trim())
    .filter(Boolean)
    .slice(0, 4)

  return {
    title,
    domain,
    priority,
    confidence,
    reviewReason,
    reasons,
    dueRaw,
    dueAt,
    notes: t.notes?.trim() || undefined,
    clarification: buildClarification(t, timezone),
  }
}

// Build the "ask, don't guess" block when the model set one. Option dates are
// re-normalized through the SAME path createTask/holdForClarification use, so a
// picked option lands an identical dueAt. Returns undefined when no usable
// question/kind was emitted (the common case — most items are clear).
function buildClarification(
  t: ModelTask,
  timezone: string | undefined,
): DraftClarification | undefined {
  const question = t.clarifyQuestion?.trim()
  if (!question || !t.clarifyKind) return undefined

  const options = (t.clarifyOptions ?? [])
    .map((o) => {
      const label = o.label?.trim()
      if (!label) return null
      let dueAt: Date | undefined
      if (o.dueAt && STRICT_DATETIME_RE.test(o.dueAt)) {
        try {
          dueAt = normalizeLocalIso(o.dueAt, timezone)
        } catch {
          dueAt = undefined
        }
      }
      return { label: label.slice(0, 80), dueAt }
    })
    .filter((o): o is { label: string; dueAt: Date | undefined } => o !== null)
    .slice(0, 4)

  return { question: question.slice(0, 300), kind: t.clarifyKind, options }
}

// NOW anchor in the speaker's timezone, with explicit offset, for the prompt.
function formatNow(timezone: string | undefined, now: Date | undefined): string {
  const ref = now ?? new Date()
  if (!timezone) return ref.toISOString()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ref)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(ref)
  const offset =
    offsetParts.find((p) => p.type === 'timeZoneName')?.value?.replace('GMT', '') || '+00:00'
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`
}
