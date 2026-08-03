import { env } from '../../../env'
import { logger } from '../../../logger'
import { Task, notDeleted, type TaskDoc } from '../../../models/Task'
import { getGeminiClient, isAiConfigured } from '../../ai/provider/geminiClient'
import type { AiLocale } from '../../ai/promptLanguage'
import { resolveAiLocale } from '../../ai/promptLanguage'
import { withGeminiRetry } from '../../ai/voiceCore/geminiRetry'
import { detectSourceLocale } from '../matterLocale'
import {
  MAX_TRANSLATE_BATCH,
  MAX_TRANSLATE_TARGETS,
  ModelTranslateSchema,
  responseSchema,
  systemFor,
} from './prompt'

// Translating a backlog into the language the user just switched to.
//
// Writes ONLY `i18n[locale]` and, where it was missing, `sourceLocale`. The
// canonical title/notes/subtask text are never touched — see the header of
// matterLocale.ts for why that separation is load-bearing rather than tidy.

/**
 * Which matters to sweep. Presets are bounded by DUE DATE and always include
 * anything overdue, because the list the user is about to read is ordered by
 * due date and overdue sits at the top of it — a "this week" that skipped last
 * month's unpaid bill would leave the most visible row untranslated.
 *
 * Undated matters have no due date to bound, so they are included only in
 * `all`. That is also the honest reading of the narrower presets: they exist to
 * cap the cost, and "everything with no date" is not a cap.
 */
export type TranslatePreset = 'thisWeek' | 'thisMonth' | 'all'

export interface TranslateSelection {
  ids?: string[]
  preset?: TranslatePreset
}

function endOfPreset(preset: TranslatePreset, now: Date): Date | null {
  if (preset === 'all') return null
  const end = new Date(now)
  if (preset === 'thisWeek') end.setUTCDate(end.getUTCDate() + 7)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

function selectionFilter(
  userId: string,
  selection: TranslateSelection,
  now: Date,
): Record<string, unknown> {
  const base = { userId, ...notDeleted(), status: { $in: ['open', 'snoozed'] } }
  if (selection.ids?.length) return { ...base, _id: { $in: selection.ids } }

  const end = endOfPreset(selection.preset ?? 'all', now)
  if (!end) return base
  // `$lte: end` alone already covers overdue — an overdue matter's dueAt is in
  // the past, which is less than the window's end.
  return { ...base, dueAt: { $ne: null, $lte: end } }
}

/** How many matters a selection would translate. Cheap: a count, no model call. */
export async function countTranslatable(args: {
  userId: string
  targetLocale: AiLocale
  selection: TranslateSelection
  now?: Date
}): Promise<number> {
  const now = args.now ?? new Date()
  const filter = selectionFilter(args.userId, args.selection, now)
  const rows = await Task.find(filter, { title: 1, sourceLocale: 1, i18n: 1 }).lean()
  return rows.filter((row) => needsTranslation(row, args.targetLocale)).length
}

function needsTranslation(
  row: { title?: string; sourceLocale?: string; i18n?: Record<string, unknown> },
  target: AiLocale,
): boolean {
  const source = resolveAiLocale(row.sourceLocale ?? detectSourceLocale(row.title))
  if (source === target) return false
  // Already has a copy in this language — re-translating would spend the
  // month's allowance reproducing text the user can already read, and would
  // overwrite any edit they have since made to it.
  return !row.i18n?.[target]
}

// One matter, as the model sees it. Subtask ids travel with the text so the
// answer can be reattached by id rather than by position — the array reorders.
function renderMatter(task: TaskDoc): string {
  const lines = [`[${String(task._id)}] ${task.title}`]
  if (task.notes) lines.push(`notes: ${task.notes}`)
  for (const sub of task.subtasks ?? []) {
    lines.push(`- <${String(sub._id)}> ${sub.text}`)
  }
  return lines.join('\n')
}

interface TranslatedMatter {
  taskId: string
  title: string
  notes: string | null
  subtasks: Record<string, string>
}

async function askModel(batch: TaskDoc[], locale: AiLocale): Promise<TranslatedMatter[]> {
  const sent = new Set(batch.map((task) => String(task._id)))
  const subtaskIds = new Map(
    batch.map((task) => [
      String(task._id),
      new Set((task.subtasks ?? []).map((sub) => String(sub._id))),
    ]),
  )

  const response = await withGeminiRetry(
    () =>
      getGeminiClient().models.generateContent({
        model: env().GEMINI_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { text: ['=== MATTERS ===', batch.map(renderMatter).join('\n\n'), '=== END ==='].join('\n') },
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
    'task-translate',
  )

  const text = (response.text ?? '').trim()
  if (!text) return []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'translate:invalid-json')
    return []
  }

  const parsed = ModelTranslateSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'translate:schema-mismatch')
    return []
  }

  const seen = new Set<string>()
  const out: TranslatedMatter[] = []
  for (const item of parsed.data.items) {
    // An invented id would write a translation onto a matter that was never
    // sent — or onto nothing, silently. Both are worse than dropping the row.
    if (!sent.has(item.taskId) || seen.has(item.taskId)) continue
    if (!item.title?.trim()) continue
    seen.add(item.taskId)

    const allowed = subtaskIds.get(item.taskId) ?? new Set<string>()
    const subtasks: Record<string, string> = {}
    for (const sub of item.subtasks ?? []) {
      if (!allowed.has(sub.id) || !sub.text.trim()) continue
      subtasks[sub.id] = sub.text.trim()
    }

    out.push({
      taskId: item.taskId,
      title: item.title.trim(),
      notes: item.notes?.trim() || null,
      subtasks,
    })
  }
  return out
}

export interface TranslateRunResult {
  /** Matters that came back with a usable translation and were written. */
  translated: number
  /** In the selection but already readable in the target language. */
  skipped: number
  /** Sent to the model and lost to a failed or unusable batch. */
  failed: number
}

export async function translateBacklog(args: {
  userId: string
  targetLocale: AiLocale
  selection: TranslateSelection
  now?: Date
}): Promise<TranslateRunResult> {
  if (!isAiConfigured()) return { translated: 0, skipped: 0, failed: 0 }

  const now = args.now ?? new Date()
  const all = await Task.find(selectionFilter(args.userId, args.selection, now)).limit(
    MAX_TRANSLATE_TARGETS,
  )

  const targets = all.filter((task) => needsTranslation(task, args.targetLocale))
  const skipped = all.length - targets.length
  if (targets.length === 0) return { translated: 0, skipped, failed: 0 }

  const results: TranslatedMatter[] = []
  let failed = 0

  for (let i = 0; i < targets.length; i += MAX_TRANSLATE_BATCH) {
    const batch = targets.slice(i, i + MAX_TRANSLATE_BATCH)
    try {
      results.push(...(await askModel(batch, args.targetLocale)))
    } catch (err: unknown) {
      // One bad batch must not lose the batches that worked — the same trade
      // categorize makes. The run reports what it got.
      failed += batch.length
      logger.warn({ err, batch: i / MAX_TRANSLATE_BATCH }, 'translate:batch-failed')
    }
  }

  const bySource = new Map(targets.map((task) => [String(task._id), task]))
  const writes = results.map((item) => {
    const task = bySource.get(item.taskId)
    const source = task?.sourceLocale ?? detectSourceLocale(task?.title, task?.notes)
    return {
      updateOne: {
        // Re-assert ownership and liveness: the matter may have been trashed
        // while the run was in flight.
        filter: { _id: item.taskId, userId: args.userId, ...notDeleted() },
        update: {
          $set: {
            sourceLocale: source,
            [`i18n.${args.targetLocale}`]: {
              title: item.title,
              ...(item.notes ? { notes: item.notes } : {}),
              ...(Object.keys(item.subtasks).length > 0 ? { subtasks: item.subtasks } : {}),
              at: now,
            },
          },
        },
      },
    }
  })

  if (writes.length > 0) await Task.bulkWrite(writes, { ordered: false })

  // Anything sent that never came back is a loss, not a skip.
  const lost = targets.length - results.length - failed
  return { translated: writes.length, skipped, failed: failed + Math.max(0, lost) }
}
