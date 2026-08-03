import { Type } from '@google/genai'
import { z } from 'zod'
import type { Types } from 'mongoose'

import { logger } from '../../logger'
import { env } from '../../env'
import { Task, notDeleted, type TaskDoc } from '../../models/Task'
import { getGeminiClient } from '../ai/provider/geminiClient'
import { conversationLanguageRule, type AiLocale } from '../ai/promptLanguage'
import { getUserAiLocale } from '../ai/userLocale'
import { withGeminiRetry } from '../ai/voiceCore/geminiRetry'
import { formatTaskLine } from './taskLine'
import { toUserObjectId } from './taskQuery'

// Search by meaning, not by keyword.
//
// "there was a task about renewing something, next month" has no exact-match
// answer: "renewing" isn't in the title ("Renew gym membership" is), and "next
// month" is a date range the user hasn't computed. A substring search returns
// nothing; a filter builder returns a predicate the user then has to check.
// What they asked for is the ANSWER.
//
// So the model reads the actual matters and picks the ones that match. It never
// queries — the server hands it a bounded pool and it returns ids, which are
// then validated against that same pool. It cannot invent a matter, and it
// cannot reach one the caller doesn't own.
//
// Ranking is the model's; the server preserves its order. Relevance order is
// the point of a search, so the result list is deliberately NOT re-grouped by
// date on the way out.

// How many matters go to the model. A personal backlog is small — this covers
// the overwhelming majority of users outright, and `truncated` tells the client
// when it didn't so the UI can say so rather than quietly under-answering.
const SEARCH_POOL_CAP = 300

const SYSTEM_BASE = `
You find the matters (reminders/tasks) a person is describing from memory.

They will describe something half-remembered — a topic, a rough time, a feeling about it.
Your job is to return the matters that actually match, best first.

You are given each matter as:
  [id] title · domain · STATE · (optionally) snoozed / moved Nx / tags / notes

STATE is one of OVERDUE by Nd / DUE TODAY / UPCOMING in Nd / NO DATE / DONE, and it is
ALWAYS authoritative. Never infer state from words in the title — a matter called "Pay
overdue veterinary bill" that is marked UPCOMING is not overdue, it is a bill about an
overdue account, due later.

MATCHING
- Match on MEANING, not spelling. "renew" matches "Renewal", "renewing", and a membership
  that plainly needs renewing. "car stuff" matches an insurance no-claims letter.
- Honour time words against the STATE and dates given: "next month", "this week",
  "late", "already done", "unscheduled".
- Combine constraints. "renewals next month" means BOTH about renewing AND falling next
  month — a renewal due today does not qualify.
- Match ACROSS languages. The search words and the matters need not be in the same one:
  a matter titled in English is a hit for an Arabic description of it, and the reverse.
  Someone whose bills arrive in one language and who thinks in another is the normal case
  here, not the edge case.
- Prefer precision. Returning three right answers beats ten with the right one buried.
- If several matters are near-identical, return them all — the person may be looking at
  duplicates and needs to see that.
- If genuinely nothing matches, return an empty list. Say so in the answer. Never pad the
  results with loosely-related matters to avoid an empty response.

IDS
- Every id you return MUST be copied exactly from the list. Never invent one.
- NEVER write an id in the answer text. Refer to matters by title.

ANSWER
- One or two plain sentences describing what you found, as you'd say it out loud.
  "Two renewals next month — your gym membership and the car insurance."
- If nothing matched, say what you looked for and that there was nothing.
- No preamble, no "I found", no bullet points, no markdown.

REASON (per match)
- A short clause saying why this one qualifies. "renewal, due Aug 12."
- Lowercase, no trailing period needed, under 60 characters.

Return ONLY the JSON object. No prose outside it.
`.trim()

function systemFor(locale: AiLocale): string {
  return [SYSTEM_BASE, conversationLanguageRule(locale)].join('\n\n')
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    answer: { type: Type.STRING },
    matches: {
      type: Type.ARRAY,
      maxItems: '40',
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          reason: { type: Type.STRING },
        },
        required: ['id', 'reason'],
        propertyOrdering: ['id', 'reason'],
      },
    },
  },
  required: ['answer', 'matches'],
  propertyOrdering: ['answer', 'matches'],
}

const ModelSearchSchema = z.object({
  answer: z.string().nullish(),
  matches: z
    .array(z.object({ id: z.string(), reason: z.string().nullish() }))
    .nullish(),
})

export interface SearchMatch {
  task: TaskDoc
  reason: string
}

export interface SemanticSearchResult {
  matches: SearchMatch[]
  answer: string
  /** True when the pool was capped, so the answer may not have seen everything. */
  truncated: boolean
}

export interface SemanticSearchArgs {
  userId: string | Types.ObjectId
  query: string
  timezone?: string
  now?: Date
}

function nowBlock(tz: string | undefined, now: Date): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZoneName: 'longOffset',
  })
  return `${fmt.format(now)} (ISO ${now.toISOString()})`
}

export async function searchMatters(
  args: SemanticSearchArgs,
): Promise<SemanticSearchResult> {
  const now = args.now ?? new Date()
  const uid = toUserObjectId(args.userId)

  // Live matters first — that is what people search for — with completed ones
  // after, so "what did I finish" still works. One extra row is fetched purely
  // to detect truncation.
  const pool = await Task.find({ userId: uid, ...notDeleted() })
    .sort({ status: 1, dueAt: 1, createdAt: -1 })
    .limit(SEARCH_POOL_CAP + 1)

  const truncated = pool.length > SEARCH_POOL_CAP
  const searchable = truncated ? pool.slice(0, SEARCH_POOL_CAP) : pool

  if (searchable.length === 0) {
    return { matches: [], answer: 'You have no matters yet.', truncated: false }
  }

  const byId = new Map(searchable.map((t) => [String(t._id), t]))
  const locale = await getUserAiLocale(String(uid))

  const response = await withGeminiRetry(
    () =>
      getGeminiClient().models.generateContent({
        model: env().GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: [
                  '=== NOW ===',
                  nowBlock(args.timezone, now),
                  '=== MATTERS ===',
                  searchable.map((t) => formatTaskLine(t, now)).join('\n'),
                  '=== THEY ARE LOOKING FOR ===',
                  args.query,
                  '=== END ===',
                ].join('\n'),
              },
            ],
          },
        ],
        config: {
          systemInstruction: systemFor(locale),
          responseMimeType: 'application/json',
          responseSchema,
          temperature: 0,
        },
      }),
    'task-search',
  )

  const text = (response.text ?? '').trim()
  if (!text) return fallbackSearch(args.query, searchable, truncated)

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'task-search:invalid-json')
    return fallbackSearch(args.query, searchable, truncated)
  }

  const parsed = ModelSearchSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'task-search:schema-mismatch')
    return fallbackSearch(args.query, searchable, truncated)
  }

  // Keep the model's ranking, drop anything it invented, and de-duplicate — a
  // repeated id would render the same row twice.
  const seen = new Set<string>()
  const matches: SearchMatch[] = []
  for (const m of parsed.data.matches ?? []) {
    const task = byId.get(m.id)
    if (!task || seen.has(m.id)) continue
    seen.add(m.id)
    matches.push({ task, reason: (m.reason ?? '').trim().slice(0, 80) })
  }

  const answer =
    parsed.data.answer?.trim() ||
    (matches.length === 0
      ? 'Nothing matched that.'
      : `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}.`)

  return { matches, answer, truncated }
}

// Substring match over title and notes. Used when the model is unavailable or
// returns something unusable — a keyword result is worse than a semantic one
// but far better than an error page, and the user still gets their matters.
function fallbackSearch(
  query: string,
  pool: TaskDoc[],
  truncated: boolean,
): SemanticSearchResult {
  const needle = query.trim().toLowerCase()
  const matches = pool
    .filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.notes ?? '').toLowerCase().includes(needle),
    )
    .slice(0, 40)
    .map((task) => ({ task, reason: 'matched on wording' }))

  return {
    matches,
    answer:
      matches.length > 0
        ? `${matches.length} ${matches.length === 1 ? 'matter mentions' : 'matters mention'} that.`
        : 'Nothing matched that.',
    truncated,
  }
}
