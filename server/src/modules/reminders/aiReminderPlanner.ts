import { env } from '../../env'
import { getGeminiClient } from '../ai/provider/geminiClient'
import type { TaskDoc } from '../../models/Task'

// The "smart" half of the hybrid: one bounded Gemini call that decides WHEN to
// nudge ahead of a deadline — lead time scaling with importance/effort. Returns
// concrete datetimes; the caller validates + falls back to the rules table on
// any failure, so this never blocks a reminder from being scheduled.

function isThinkingCapableModel(modelId: string): boolean {
  return /gemini-2\.5/.test(modelId)
}

function buildPrompt(task: TaskDoc, now: Date): string {
  return [
    'You schedule smart reminder nudges for a life-admin task. Decide WHEN to nudge the user ahead of the deadline. The lead time should scale with importance and effort: a passport renewal weeks-to-months out, an insurance/registration renewal weeks out, a bill a few days, a quick call/appointment about a day.',
    `Task: "${task.title}" — domain ${task.domain}, priority ${task.priority}.`,
    `Due (ISO): ${task.dueAt?.toISOString()}`,
    `Now (ISO): ${now.toISOString()}`,
    'Return ONLY a JSON array of 1-3 ISO 8601 datetimes (with offset), each strictly AFTER now and AT or BEFORE the due time. No prose. Example: ["2026-07-20T09:00:00+03:00","2026-08-18T09:00:00+03:00"]',
  ].join('\n')
}

export async function suggestReminderTimes(task: TaskDoc, now: Date): Promise<Date[]> {
  const client = getGeminiClient()
  const modelId = env().GEMINI_MODEL
  const res = await client.models.generateContent({
    model: modelId,
    contents: [{ role: 'user', parts: [{ text: buildPrompt(task, now) }] }],
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      ...(isThinkingCapableModel(modelId) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  })
  const text = res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((s): s is string => typeof s === 'string')
    .map((s) => new Date(s))
    .filter((d) => !Number.isNaN(d.getTime()))
}
