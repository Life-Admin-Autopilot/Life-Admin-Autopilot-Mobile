import { Type } from '@google/genai'
import { z } from 'zod'
import type { Types } from 'mongoose'

import { logger } from '../../logger'
import { env } from '../../env'
import {
  ESTIMATE_BUCKETS,
  ESTIMATE_BUCKET_LABELS,
  Task,
  normalizeEstimate,
  notDeleted,
} from '../../models/Task'
import { getGeminiClient } from '../ai/provider/geminiClient'
import { withGeminiRetry } from '../ai/voiceCore/geminiRetry'
import { toUserObjectId } from './taskQuery'

// Estimates for matters that predate the feature.
//
// Every task created from here on gets an estimate from whichever path created
// it (voice, scan, chat). Tasks that already existed have none, and nothing in
// the app can invent one for them for free — the judgment is the AI call.
//
// So this is a BATCH backfill: one model round trip for many titles, run on
// demand rather than on read. A per-row lazy estimate would put an AI call on
// the list endpoint, which is the hottest path in the app and the last place
// that latency belongs.
//
// It only ever fills in blanks. A task that already carries an estimate —
// whether the AI or the user set it — is not in the query at all, so a
// hand-set window cannot be overwritten by a backfill that runs later.

// One round trip's worth. Bounded because the whole point is a single cheap
// call: a user with 400 stale tasks backfills over several runs rather than one
// enormous prompt that degrades the answers in it.
export const MAX_BACKLOG_BATCH = 40

export interface BacklogEstimateResult {
  /** Tasks written in this pass. */
  estimated: number
  /** Tasks still lacking an estimate afterwards — drives "run it again". */
  remaining: number
}

const ModelBacklogSchema = z.object({
  estimates: z
    .array(
      z.object({
        taskId: z.string(),
        minMinutes: z.union([z.string().max(8), z.number()]).nullish(),
        maxMinutes: z.union([z.string().max(8), z.number()]).nullish(),
      }),
    )
    .catch([]),
})

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    estimates: {
      type: Type.ARRAY,
      maxItems: String(MAX_BACKLOG_BATCH),
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: { type: Type.STRING },
          // STRING because Gemini's enum constraint only applies to strings.
          minMinutes: { type: Type.STRING, enum: ESTIMATE_BUCKET_LABELS },
          maxMinutes: { type: Type.STRING, enum: ESTIMATE_BUCKET_LABELS },
        },
        required: ['taskId', 'minMinutes', 'maxMinutes'],
        propertyOrdering: ['taskId', 'minMinutes', 'maxMinutes'],
      },
    },
  },
  required: ['estimates'],
}

const SYSTEM = `
You estimate how long each of a person's to-dos takes to DO.

You are given matters, one per line, as:
  [id] title · domain

For EVERY id you are given, return one estimate with minMinutes and maxMinutes.
Both MUST be one of exactly these values: ${ESTIMATE_BUCKETS.join(', ')}. Nothing
between them exists — there is no "23 minutes", because nobody can know that.
maxMinutes must be >= minMinutes; use the same value twice when the job is tight.

Estimate the DOING, never the waiting and never the calendar distance. "Book a
dentist appointment" is a 5-10 minute phone call, not the appointment. "Renew car
insurance" is the paperwork, not the year of cover. The amount of money involved
does not change how long a payment takes.

Never invent an id. Never return an id you were not given. When a title is too
vague to judge, give a WIDE range rather than a confident narrow one.

Return ONLY the JSON object. No prose.
`.trim()

export interface EstimateBacklogArgs {
  userId: string | Types.ObjectId
  limit?: number
}

// Fill in estimates for up to `limit` un-estimated live matters. Degrades to
// `estimated: 0` rather than throwing when the model is unavailable or answers
// unusably — a backfill is an improvement, never a thing worth failing a
// request over.
export async function estimateBacklog(
  args: EstimateBacklogArgs,
): Promise<BacklogEstimateResult> {
  const uid = toUserObjectId(args.userId)
  const limit = Math.min(Math.max(args.limit ?? MAX_BACKLOG_BATCH, 1), MAX_BACKLOG_BATCH)

  // `estimate: { $exists: false }` is what makes this safe to re-run: an
  // estimate of ANY source is already an answer, so the pass never sees it.
  // Done matters are skipped — nobody plans time for work already finished.
  const filter = {
    userId: uid,
    status: { $ne: 'done' },
    estimate: { $exists: false },
    ...notDeleted(),
  }

  const pending = await Task.find(filter).sort({ dueAt: 1, createdAt: -1 }).limit(limit)
  if (pending.length === 0) return { estimated: 0, remaining: 0 }

  const byId = new Map(pending.map((t) => [String(t._id), t]))

  let response
  try {
    response = await withGeminiRetry(
      () =>
        getGeminiClient().models.generateContent({
          model: env().GEMINI_MODEL,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: [
                    '=== MATTERS ===',
                    pending.map((t) => `[${String(t._id)}] ${t.title} · ${t.domain}`).join('\n'),
                    '=== END ===',
                  ].join('\n'),
                },
              ],
            },
          ],
          config: {
            systemInstruction: SYSTEM,
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0,
          },
        }),
      'task-estimate-backlog',
    )
  } catch (err: unknown) {
    logger.warn({ err }, 'estimate-backlog:model-failed')
    return { estimated: 0, remaining: await countUnestimated(filter) }
  }

  const text = (response.text ?? '').trim()
  if (!text) return { estimated: 0, remaining: await countUnestimated(filter) }

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'estimate-backlog:invalid-json')
    return { estimated: 0, remaining: await countUnestimated(filter) }
  }

  const parsed = ModelBacklogSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'estimate-backlog:schema-mismatch')
    return { estimated: 0, remaining: await countUnestimated(filter) }
  }

  // Drop every id the model did not actually receive, then snap. An invented id
  // would otherwise write an estimate onto somebody's unrelated matter.
  const seen = new Set<string>()
  const writes = parsed.data.estimates.flatMap((e) => {
    if (!byId.has(e.taskId) || seen.has(e.taskId)) return []
    const estimate = normalizeEstimate(e, 'ai')
    if (!estimate) return []
    seen.add(e.taskId)
    return [
      {
        updateOne: {
          // Re-asserting `$exists: false` closes the race where the user set an
          // estimate by hand while the model was thinking. Theirs wins.
          filter: { _id: e.taskId, userId: uid, estimate: { $exists: false } },
          update: { $set: { estimate } },
        },
      },
    ]
  })

  if (writes.length === 0) return { estimated: 0, remaining: await countUnestimated(filter) }

  const result = await Task.bulkWrite(writes, { ordered: false })
  return {
    estimated: result.modifiedCount ?? 0,
    remaining: await countUnestimated(filter),
  }
}

function countUnestimated(filter: Record<string, unknown>): Promise<number> {
  return Task.countDocuments(filter)
}
