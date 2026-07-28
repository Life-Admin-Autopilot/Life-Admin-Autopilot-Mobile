import type { Types } from 'mongoose'

import { logger } from '../../../logger'
import { env } from '../../../env'
import {
  CONFIDENCE_BUCKETS,
  MAX_TAGS,
  Task,
  normalizeTag,
  notDeleted,
  type ConfidenceBucket,
  type TaskDoc,
} from '../../../models/Task'
import { DOMAINS, type Domain } from '../../../models/User'
import { TaskBulkOp, bulkOpExpiry, type BulkOpEntry } from '../../../models/TaskBulkOp'
import { BadRequest } from '../../../lib/errors'
import { getGeminiClient } from '../../ai/provider/geminiClient'
import { withGeminiRetry } from '../../ai/voiceCore/geminiRetry'
import { resolveTargets, type BulkTarget } from '../bulkService'
import {
  MAX_CATEGORIZE_BATCH,
  MAX_CATEGORIZE_TARGETS,
  MAX_PROPOSED_TAGS,
  ModelCategorizeSchema,
  SYSTEM,
  responseSchema,
} from './prompt'

// Propose a refiling of existing matters. Writes NOTHING to Task.
//
// This is the corrective sibling of estimateBacklog, and the difference drives
// the whole design. An estimate fills a blank: there is no prior answer to be
// wrong about, so it writes straight through. A domain is REQUIRED on every
// task and was already set by whoever created it, so this pass is always
// overwriting a real answer — sometimes one the user chose by hand.
//
// So it proposes. The run lands as a TaskBulkOp in `proposed`, the user reads
// the diff, and only the rows they keep are ever written. That is what the
// model's `proposed` status and per-entry confidence/reason were designed for.

const DOMAIN_SET = new Set<string>(DOMAINS)
const CONFIDENCE_SET = new Set<string>(CONFIDENCE_BUCKETS)

export interface ProposedChange {
  taskId: string
  title: string
  fromDomain: Domain
  toDomain: Domain
  /** Only the tags this would ADD. Existing tags are never removed. */
  addedTags: string[]
  confidence: ConfidenceBucket
  reason: string
}

export interface ProposalResult {
  opId: string
  changes: ProposedChange[]
  /** Matters looked at but left alone — the model agreed with their filing. */
  unchanged: number
}

interface ModelItem {
  taskId: string
  domain: Domain
  confidence: ConfidenceBucket
  reason: string
  tags: string[]
}

// One matter, as the model sees it. Deliberately WITHOUT the current domain:
// showing it would anchor a pass whose entire job is to re-judge that value.
function renderTask(task: TaskDoc): string {
  const lines = [`[${String(task._id)}] ${task.title}`]
  if (task.notes) lines.push(`notes: ${task.notes.slice(0, 200)}`)
  if (task.tags.length > 0) lines.push(`tags: ${task.tags.join(', ')}`)
  return lines.join('\n')
}

async function askModel(batch: TaskDoc[], vocabulary: string[]): Promise<ModelItem[]> {
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
                  '=== TAGS THIS PERSON ALREADY USES ===',
                  vocabulary.length > 0 ? vocabulary.join(', ') : '(none yet)',
                  '=== MATTERS ===',
                  batch.map(renderTask).join('\n\n'),
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
    'task-categorize',
  )

  const text = (response.text ?? '').trim()
  if (!text) return []

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err: unknown) {
    logger.warn({ err }, 'categorize:invalid-json')
    return []
  }

  const parsed = ModelCategorizeSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues }, 'categorize:schema-mismatch')
    return []
  }

  const sent = new Set(batch.map((t) => String(t._id)))
  const seen = new Set<string>()

  return parsed.data.items.flatMap((item) => {
    // An id the model invented would refile somebody's unrelated matter. Same
    // guard as estimateBacklog, for the same reason.
    if (!sent.has(item.taskId) || seen.has(item.taskId)) return []
    if (!item.domain || !DOMAIN_SET.has(item.domain)) return []
    seen.add(item.taskId)
    return [
      {
        taskId: item.taskId,
        domain: item.domain as Domain,
        confidence: (item.confidence && CONFIDENCE_SET.has(item.confidence)
          ? item.confidence
          : 'low') as ConfidenceBucket,
        reason: (item.reason ?? '').trim().slice(0, 240),
        tags: (item.tags ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      },
    ]
  })
}

// Tags are ADDITIVE. Proposing a set that drops a tag the user typed themselves
// would be a silent deletion dressed up as a suggestion, so the union is what
// gets written and the original array is what gets recorded for undo.
function additionalTags(task: TaskDoc, proposed: string[]): string[] {
  const existing = new Set(task.tags)
  const additions: string[] = []
  for (const raw of proposed.slice(0, MAX_PROPOSED_TAGS)) {
    const tag = normalizeTag(raw)
    if (!tag || existing.has(tag) || additions.includes(tag)) continue
    if (task.tags.length + additions.length >= MAX_TAGS) break
    additions.push(tag)
  }
  return additions
}

export interface ProposeArgs {
  userId: string
  target: BulkTarget
  now?: Date
}

export async function proposeCategorization(args: ProposeArgs): Promise<ProposalResult> {
  const now = args.now ?? new Date()
  const { userId, target } = args

  const tasks = await resolveTargets(userId, target, now)
  if (tasks.length === 0) {
    throw BadRequest('no_targets', 'Nothing to categorise.')
  }
  if (tasks.length > MAX_CATEGORIZE_TARGETS) {
    throw BadRequest(
      'categorize_too_many',
      `Categorising works on up to ${MAX_CATEGORIZE_TARGETS} matters at a time. Select fewer.`,
    )
  }

  // The user's own tag vocabulary, so the model reuses "insurance" instead of
  // minting "car-insurance-renewal" beside it.
  const vocabulary = ((await Task.distinct('tags', {
    userId,
    ...notDeleted(),
  })) as string[]).sort()

  const byId = new Map(tasks.map((t) => [String(t._id), t]))
  const items: ModelItem[] = []

  for (let i = 0; i < tasks.length; i += MAX_CATEGORIZE_BATCH) {
    const batch = tasks.slice(i, i + MAX_CATEGORIZE_BATCH)
    try {
      items.push(...(await askModel(batch, vocabulary)))
    } catch (err: unknown) {
      // One bad batch must not lose the batches that worked. The run reports
      // what it got; the user can run it again for the rest.
      logger.warn({ err, batch: i / MAX_CATEGORIZE_BATCH }, 'categorize:batch-failed')
    }
  }

  const entries: BulkOpEntry[] = []
  const changes: ProposedChange[] = []

  for (const item of items) {
    const task = byId.get(item.taskId)
    if (!task) continue

    const domainMoved = item.domain !== task.domain
    const addedTags = additionalTags(task, item.tags)
    // Agreement is not a diff. A row that proposes nothing is noise in a
    // review screen whose whole job is to be readable.
    if (!domainMoved && addedTags.length === 0) continue

    const prior: Record<string, unknown> = {}
    const next: Record<string, unknown> = {}
    if (domainMoved) {
      prior.domain = task.domain
      next.domain = item.domain
    }
    if (addedTags.length > 0) {
      prior.tags = [...task.tags]
      next.tags = [...task.tags, ...addedTags].slice(0, MAX_TAGS)
    }

    entries.push({
      taskId: task._id as Types.ObjectId,
      prior,
      next,
      confidence: item.confidence,
      reason: item.reason,
    })
    changes.push({
      taskId: String(task._id),
      title: task.title,
      fromDomain: task.domain,
      toDomain: item.domain,
      addedTags,
      confidence: item.confidence,
      reason: item.reason,
    })
  }

  // Nothing to propose is a success, not an error — it means the filing was
  // already right. No op record is written, so the one-open-proposal slot
  // stays free.
  if (entries.length === 0) {
    return { opId: '', changes: [], unchanged: tasks.length }
  }

  const op = await TaskBulkOp.create({
    userId,
    kind: 'categorize',
    action: 'categorize',
    status: 'proposed',
    entries,
    label: `Categorise ${tasks.length} ${tasks.length === 1 ? 'matter' : 'matters'}`,
    expiresAt: bulkOpExpiry(now),
  })

  return {
    opId: String(op._id),
    changes,
    unchanged: tasks.length - changes.length,
  }
}
