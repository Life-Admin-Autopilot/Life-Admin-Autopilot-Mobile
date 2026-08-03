import { Type } from '@google/genai'
import { z } from 'zod'

import { logger } from '../../logger'
import { env } from '../../env'
import { Task } from '../../models/Task'
import type { DailyDigestTheme } from '../../models/DailyDigest'
import { getGeminiClient, isAiConfigured } from '../ai/provider/geminiClient'
import { conversationLanguageRule, type AiLocale } from '../ai/promptLanguage'
import { withGeminiRetry } from '../ai/voiceCore/geminiRetry'
import { admitWithinQuota, releaseUsageSlot } from '../ai/quota'
import { stripObjectIds } from './summarize'
import { formatTaskLine } from './taskLine'

// The only half of the daily digest a language model is allowed to write: one
// sentence and a handful of theme labels. Every figure is computed in code —
// see the header of dailyDigest.ts for why that line is drawn where it is.
//
// Split out because the counting and the prose fail differently. Everything
// here returns null instead of throwing: by the time it runs, the digest is
// already complete and correct, and giving up something real because the
// decorative layer was unavailable is the wrong trade.

const ModelDigestSchema = z.object({
  headline: z.string().nullish(),
  themes: z
    .array(z.object({ label: z.string(), taskIds: z.array(z.string()).nullish() }))
    .nullish(),
})

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    themes: {
      type: Type.ARRAY,
      maxItems: '4',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          taskIds: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['label', 'taskIds'],
        propertyOrdering: ['label', 'taskIds'],
      },
    },
  },
  required: ['headline', 'themes'],
  propertyOrdering: ['headline', 'themes'],
}

const SYSTEM_BASE = `
You group a person's matters for today into themes and write one sentence about the day.

You are given their live matters, each as:
  [id] title · domain · STATE · (optionally) moved Nx

STATE is one of OVERDUE by Nd / DUE TODAY / UPCOMING in Nd / NO DATE, and it is ALWAYS
authoritative. Never infer a matter's state from words in its title — a matter called
"Pay overdue veterinary bill" that is marked UPCOMING is NOT overdue, it is a bill about
an overdue account, due later. Getting this backwards produces a sentence that
contradicts itself, which is worse than saying nothing.

IDS — ABSOLUTE RULE
The ids exist so the app can link a row. They are meaningless to the person reading this.
NEVER write an id in the headline. Not in parentheses, not as "e.g.", not ever. Refer to
a matter by its TITLE in quotes. Put the id in the taskIds field, nothing else.

THEMES
- 2 to 4 groupings that reflect what is actually going on ("Car paperwork", "Aya's school run").
- Group by real-world thread, NOT by the domain field — they can already filter by domain.
- Every id you place in a theme MUST come from the list. Never invent an id.
- A matter may appear in at most one theme. Leave one-offs out rather than forcing a group.

HEADLINE
- ONE sentence. Plain, specific to today, naming the dominant thread.
- Calm and unhurried. This is the first thing they read when they open the app.
- Never imply they are behind, late, or failing. No "still", "finally", "already".
  Do not count what they have not done.
- No cheerleading, no motivational language, no "you've got this", no exclamation marks.
- Call them "matters", never "tasks" or "items".

Return ONLY the JSON object. No prose.
`.trim()

// The headline is the first thing on the home screen. Written in English under an
// Arabic layout it is not a rough edge, it is the app dropping its own language
// on the one surface nobody has to navigate to.
function systemFor(locale: AiLocale): string {
  return [SYSTEM_BASE, conversationLanguageRule(locale)].join('\n\n')
}

export interface DigestProse {
  headline: string | null
  themes: DailyDigestTheme[]
}

export async function writeDigestProse(args: {
  userId: string
  /** The matters the model may name. Raw rows, as read by the digest. */
  pool: Record<string, unknown>[]
  now: Date
  locale: AiLocale
}): Promise<DigestProse | null> {
  if (args.pool.length === 0) return null
  if (!isAiConfigured()) return null

  // A rebuild costs a chat turn's worth of Gemini, so it is charged like one.
  // On a spent allowance the digest still answers — it just keeps the previous
  // themes and a computed headline.
  try {
    await admitWithinQuota({ userId: args.userId, tier: 'free', kind: 'message' })
  } catch (err: unknown) {
    logger.info({ err }, 'daily-digest:quota-unavailable')
    return null
  }

  let text: string
  try {
    // Hydrated only to describe them: formatTaskLine resolves each matter's
    // STATE in one place, so a matter reads identically here, in the range
    // summary, and in search.
    const lines = args.pool.map((row) => formatTaskLine(Task.hydrate(row), args.now)).join('\n')

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
                    args.now.toISOString(),
                    '=== MATTERS ===',
                    lines,
                    '=== END ===',
                  ].join('\n'),
                },
              ],
            },
          ],
          config: {
            systemInstruction: systemFor(args.locale),
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.2,
          },
        }),
      'daily-digest',
    )
    text = (response.text ?? '').trim()
  } catch (err: unknown) {
    // Refund the slot — the user got nothing for it.
    await releaseUsageSlot({ userId: args.userId, kind: 'message' }).catch(() => {})
    logger.warn({ err }, 'daily-digest:model-failed')
    return null
  }

  if (!text) return null

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'daily-digest:invalid-json')
    return null
  }

  const parsed = ModelDigestSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'daily-digest:schema-mismatch')
    return null
  }

  const ids = new Set(args.pool.map((row) => String(row._id)))
  return {
    headline: stripObjectIds(parsed.data.headline?.trim() ?? ''),
    themes: keepRealThemes(parsed.data.themes ?? [], ids),
  }
}

// Drop every id that is not in the pool we actually sent, and every duplicate
// placement. Without this an invented id becomes a theme the user can tap into
// and find empty — which reads as the app losing their data.
//
// Also the gate for carried-forward themes: an earlier build's labels are
// re-checked against the current matters, so a theme can never outlive the rows
// it describes.
export function keepRealThemes(
  themes: { label: string; taskIds?: string[] | null }[],
  ids: Set<string>,
): DailyDigestTheme[] {
  const seen = new Set<string>()
  return themes
    .map((theme) => {
      const taskIds = (theme.taskIds ?? []).filter((id) => ids.has(id) && !seen.has(id))
      taskIds.forEach((id) => seen.add(id))
      return { label: theme.label.trim(), count: taskIds.length, taskIds }
    })
    .filter((theme) => theme.label.length > 0 && theme.count > 0)
}
