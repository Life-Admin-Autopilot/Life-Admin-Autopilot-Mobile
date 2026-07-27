import { Type } from '@google/genai'
import { z } from 'zod'
import type { Types } from 'mongoose'

import { logger } from '../../logger'
import { env } from '../../env'
import { Task, notDeleted, type TaskDoc } from '../../models/Task'
import { getGeminiClient } from '../ai/provider/geminiClient'
import { withGeminiRetry } from '../ai/voiceCore/geminiRetry'
import { formatTaskLine } from './taskLine'
import { toUserObjectId } from './taskQuery'

// "Summarize my next month" — as a structured report, not a paragraph.
//
// The shape is the point. A prose summary of a task list is strictly worse than
// the list itself: it compresses without deciding anything. What is actually
// useful is counts with deltas, themes you can tap into, what slipped, and one
// question worth answering.
//
// Every number is computed IN CODE from real documents. The model only names
// themes and writes the one question. That split matters — a summary whose
// figures came out of a language model is a surface for confident wrong
// answers, and the user has no way to check it.

const MAX_TASKS_TO_MODEL = 120

export interface SummaryTheme {
  label: string
  count: number
  taskIds: string[]
  examples: string[]
}

export interface SummarySlip {
  taskId: string
  title: string
  reason: string
}

// Near-identical matters in the same window. Detected in CODE, not by the
// model: it is an exact-match grouping question, and asking a language model to
// notice it produces rambling prose about ids instead of a countable fact the
// UI can act on.
export interface SummaryDuplicate {
  title: string
  count: number
  taskIds: string[]
}

export interface TaskSummary {
  range: { from: string; to: string }
  counts: {
    dueInRange: number
    completedInRange: number
    createdInRange: number
    // Same-length window immediately before, for an honest comparison.
    completedPrevious: number
    stillOpen: number
    overdue: number
  }
  themes: SummaryTheme[]
  slipping: SummarySlip[]
  duplicates: SummaryDuplicate[]
  // Completed in range with no due date — reactive work the user did but never
  // planned. People feel this load and can rarely evidence it.
  unplannedCompleted: { taskId: string; title: string }[]
  busiestDay: { date: string; count: number } | null
  headline: string
  question: { text: string; taskId: string | null } | null
}

const ModelSummarySchema = z.object({
  headline: z.string().nullish(),
  themes: z
    .array(
      z.object({
        label: z.string(),
        taskIds: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
  question: z
    .object({
      text: z.string().nullish(),
      taskId: z.string().nullish(),
    })
    .nullish(),
})

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    themes: {
      type: Type.ARRAY,
      maxItems: '5',
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
    question: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        text: { type: Type.STRING },
        taskId: { type: Type.STRING, nullable: true },
      },
      required: ['text'],
      propertyOrdering: ['text', 'taskId'],
    },
  },
  required: ['headline', 'themes'],
  propertyOrdering: ['headline', 'themes', 'question'],
}

const SYSTEM = `
You group a person's reminders into themes and notice the one thing worth asking about.

You are given their matters for a date range, each as:
  [id] title · domain · STATE · (optionally) moved Nx

STATE is one of OVERDUE by Nd / DUE TODAY / UPCOMING in Nd / NO DATE / DONE, and it is
ALWAYS authoritative. Never infer a matter's state from words in its title — a matter called
"Pay overdue veterinary bill" that is marked UPCOMING is NOT overdue, it is a bill about an
overdue account, due later. Getting this backwards produces a sentence that contradicts
itself, which is worse than saying nothing.

IDS — ABSOLUTE RULE
The ids exist so the app can link a row. They are meaningless to the person reading this.
NEVER write an id in headline or question text. Not in parentheses, not as "e.g.", not ever.
Refer to a matter by its TITLE in quotes. Put the id in the taskId field, nothing else.

THEMES
- 2 to 5 groupings that reflect what is actually going on ("Car paperwork", "Aya's school run").
- Group by real-world thread, NOT by the domain field — they can already filter by domain.
- Every id you place in a theme MUST come from the list. Never invent an id.
- A matter may appear in at most one theme. Leave one-offs out rather than forcing a group.

HEADLINE
- One sentence, plain, specific to this range. Name the dominant thread.
- No cheerleading, no "you've got this", no exclamation marks.

QUESTION
- You may ONLY ask about a matter listed under CANDIDATES. If CANDIDATES is empty, question
  MUST be null. Do not go looking for something to ask about in the main list — the app has
  already decided what qualifies, and anything else is noise dressed as insight.
- At most one. Phrase it as a real question you'd ask a friend, naming the matter by title.
- Ground it in the reason given for that candidate, and stay consistent with its STATE.
- Do NOT ask about repeated or duplicate-looking titles. The app detects those itself.
- A forced question is worse than none.

Return ONLY the JSON object. No prose.
`.trim()

// A prompt rule is not an enforcement mechanism. The model was told never to
// put an id in prose; this is what happens when it does anyway.
//
// Strips "(e.g., 6a63c5...)" style parentheticals and any bare 24-hex id, then
// tidies the punctuation the removal leaves behind. If what remains is too
// short to be a real question, the question is dropped — a mangled sentence is
// worse than none.
const OBJECT_ID_RE = /[0-9a-f]{24}/gi

export function stripObjectIds(text: string): string | null {
  const cleaned = text
    .replace(/\s*\((?:e\.?g\.?,?\s*)?[0-9a-f]{24}\)/gi, '')
    .replace(OBJECT_ID_RE, '')
    .replace(/\(\s*[,;]?\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.?!])/g, '$1')
    .trim()
  return cleaned.length >= 12 ? cleaned : null
}

// Group by normalized title. Exact-ish duplicates are what actually happen when
// the same bill gets captured by chat, by voice, and off a scanned document.
function findDuplicates(tasks: TaskDoc[]): SummaryDuplicate[] {
  const bins = new Map<string, TaskDoc[]>()
  for (const t of tasks) {
    const key = t.title.trim().toLowerCase().replace(/\s+/g, ' ')
    const bin = bins.get(key)
    if (bin) bin.push(t)
    else bins.set(key, [t])
  }
  return [...bins.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length)
    .slice(0, 5)
    .map((group) => ({
      title: group[0]?.title ?? '',
      count: group.length,
      taskIds: group.map((t) => String(t._id)),
    }))
    .filter((dupe) => dupe.title.length > 0)
}

export interface SummarizeArgs {
  userId: string | Types.ObjectId
  from: Date
  to: Date
  timezone?: string
  now?: Date
}

export async function summarizeRange(args: SummarizeArgs): Promise<TaskSummary> {
  const now = args.now ?? new Date()
  const uid = toUserObjectId(args.userId)
  const span = args.to.getTime() - args.from.getTime()
  const prevFrom = new Date(args.from.getTime() - span)

  const base = { userId: uid, ...notDeleted() }

  const [dueInRange, completedInRange, createdInRange, completedPrevious] = await Promise.all([
    Task.find({ ...base, dueAt: { $gte: args.from, $lte: args.to } }).sort({ dueAt: 1 }),
    Task.find({ ...base, status: 'done', completedAt: { $gte: args.from, $lte: args.to } }).sort({
      completedAt: 1,
    }),
    Task.countDocuments({ ...base, createdAt: { $gte: args.from, $lte: args.to } }),
    Task.countDocuments({
      ...base,
      status: 'done',
      completedAt: { $gte: prevFrom, $lt: args.from },
    }),
  ])

  const stillOpen = dueInRange.filter((t) => t.status !== 'done').length
  const overdue = dueInRange.filter(
    (t) => t.status !== 'done' && t.dueAt && t.dueAt < now,
  ).length

  // Slipping: pushed back repeatedly, or long past due. Named individually
  // because "3 things are slipping" is not actionable and "renew your passport"
  // is.
  const slipping: SummarySlip[] = dueInRange
    .filter((t) => t.status !== 'done')
    .filter(
      (t) =>
        t.rescheduleCount >= 3 ||
        (t.dueAt ? t.dueAt.getTime() < now.getTime() - 14 * 86_400_000 : false),
    )
    .slice(0, 8)
    .map((t) => ({
      taskId: String(t._id),
      title: t.title,
      reason:
        t.rescheduleCount >= 3
          ? `moved ${t.rescheduleCount} times`
          : 'overdue more than two weeks',
    }))

  const unplannedCompleted = completedInRange
    .filter((t) => !t.dueAt)
    .slice(0, 8)
    .map((t) => ({ taskId: String(t._id), title: t.title }))

  // Heaviest day by due count — the input to "want me to spread these out?".
  const byDay = new Map<string, number>()
  for (const t of dueInRange) {
    if (!t.dueAt) continue
    const key = new Intl.DateTimeFormat('en-CA', {
      timeZone: args.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(t.dueAt)
    byDay.set(key, (byDay.get(key) ?? 0) + 1)
  }
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]

  const counts = {
    dueInRange: dueInRange.length,
    completedInRange: completedInRange.length,
    createdInRange,
    completedPrevious,
    stillOpen,
    overdue,
  }

  const empty: TaskSummary = {
    range: { from: args.from.toISOString(), to: args.to.toISOString() },
    counts,
    themes: [],
    slipping,
    duplicates: findDuplicates(dueInRange.filter((t) => t.status !== 'done')),
    unplannedCompleted,
    busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
    headline:
      dueInRange.length === 0
        ? 'Nothing scheduled in this window.'
        : `${dueInRange.length} matters fall in this window.`,
    question: null,
  }

  if (dueInRange.length === 0) return empty

  // Themes and the question are the only parts the model writes.
  const pool = [...dueInRange, ...completedInRange].slice(0, MAX_TASKS_TO_MODEL)
  const byId = new Map(pool.map((t) => [String(t._id), t]))

  // The only matters the model is allowed to raise a question about. Computing
  // the shortlist here — rather than asking the model to find something notable
  // — is what stops it manufacturing concern about a perfectly ordinary task.
  const candidates = slipping
    .filter((s) => byId.has(s.taskId))
    .map((s) => `[${s.taskId}] "${s.title}" — ${s.reason}`)

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
                    '=== NOW ===',
                    now.toISOString(),
                    '=== RANGE ===',
                    `${args.from.toISOString()} to ${args.to.toISOString()}`,
                    '=== MATTERS ===',
                    pool.map((t) => formatTaskLine(t, now)).join('\n'),
                    '=== CANDIDATES (the only matters you may ask a question about) ===',
                    candidates.length > 0 ? candidates.join('\n') : '(none — question MUST be null)',
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
            temperature: 0.2,
          },
        }),
      'task-summarize',
    )
  } catch (err: unknown) {
    // The computed half is still worth showing — degrade to it rather than
    // failing the whole request because the narrative layer was unavailable.
    logger.warn({ err }, 'task-summarize:model-failed')
    return empty
  }

  const text = (response.text ?? '').trim()
  if (!text) return empty

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'task-summarize:invalid-json')
    return empty
  }

  const parsed = ModelSummarySchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'task-summarize:schema-mismatch')
    return empty
  }

  // Drop every id the model did not actually receive. Without this an invented
  // id becomes a theme the user can tap into and find empty — which reads as
  // the app losing their data.
  const seen = new Set<string>()
  const themes: SummaryTheme[] = (parsed.data.themes ?? [])
    .map((theme) => {
      const ids = (theme.taskIds ?? []).filter((id) => byId.has(id) && !seen.has(id))
      ids.forEach((id) => seen.add(id))
      // Examples must be DISTINCT titles. A theme built from eleven copies of
      // "Pay electricity bill" would otherwise render as
      // "Pay electricity bill · Pay electricity bill", which reads as a bug.
      const examples: string[] = []
      for (const id of ids) {
        const title = byId.get(id)?.title
        if (title && !examples.includes(title)) examples.push(title)
        if (examples.length === 2) break
      }
      return { label: theme.label.trim(), count: ids.length, taskIds: ids, examples }
    })
    .filter((theme) => theme.label.length > 0 && theme.count > 0)

  // Enforce the candidate rule rather than trusting it. With no candidate there
  // is nothing worth asking, so any question the model produced anyway is
  // manufactured concern — drop it.
  const candidateIds = new Set(slipping.map((s) => s.taskId))
  const q = parsed.data.question
  const questionTaskId = q?.taskId && candidateIds.has(q.taskId) ? q.taskId : null
  const questionText =
    questionTaskId && q?.text?.trim() ? stripObjectIds(q.text.trim()) : null

  return {
    ...empty,
    themes,
    headline: stripObjectIds(parsed.data.headline?.trim() ?? '') ?? empty.headline,
    question: questionText ? { text: questionText, taskId: questionTaskId } : null,
  }
}
