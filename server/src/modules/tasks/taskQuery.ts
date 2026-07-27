import { z } from 'zod'
import { Types, type PipelineStage } from 'mongoose'
import { DOMAINS } from '../../models/User'
import {
  PRIORITY_RANK,
  Task,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  normalizeTag,
  notDeleted,
  type TaskDoc,
} from '../../models/Task'

// The one place a Matters query is defined.
//
// Three callers share this: the REST list (`me.tasks.ts`), the chat agent's
// `queryTasks` tool (`modules/ai/toolRunner.ts`), and the NL search compiler.
// They MUST stay in lockstep — if the UI can express a filter the agent can't,
// "show me what you just showed me" stops working. Adding a filter here adds it
// to all three at once.

// Sentinels that push date-less tasks to the END of a due-date sort in both
// directions. Mongo orders missing fields first ascending, which would bury a
// user's dated work under an undated backlog.
const FAR_FUTURE = new Date(8640000000000000)
const FAR_PAST = new Date(-8640000000000000)

export const TASK_SORTS = [
  'due-asc',
  'due-desc',
  'created-desc',
  'created-asc',
  'priority-desc',
  'title-asc',
] as const
export type TaskSort = (typeof TASK_SORTS)[number]

export const DEFAULT_TASK_SORT: TaskSort = 'due-asc'

// Comma-separated multi-value enum: `?status=open,snoozed`. Rejects the whole
// request on an unknown member rather than silently ignoring it — a typo'd
// filter that quietly returns everything is worse than an error.
function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  const allowed = new Set<string>(values)
  return z
    .string()
    .transform((raw) => raw.split(',').map((s) => s.trim()).filter(Boolean))
    .superRefine((parts, ctx) => {
      for (const part of parts) {
        if (!allowed.has(part)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `expected one of ${values.join('|')}, got "${part}"`,
          })
        }
      }
      if (parts.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must not be empty' })
      }
    })
    .transform((parts) => parts as unknown as T[number][])
}

const IsoDate = z
  .string()
  .datetime()
  .transform((v) => new Date(v))

// Query strings arrive as "true"/"false"; z.coerce.boolean() would turn the
// string "false" into `true`, so parse explicitly.
const QueryBool = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')

export const TaskFilterSchema = z.object({
  // Free-text over title + notes.
  q: z.string().trim().min(1).max(200).optional(),
  status: csvEnum(TASK_STATUSES).optional(),
  domain: csvEnum(DOMAINS).optional(),
  priority: csvEnum(TASK_PRIORITIES).optional(),
  kind: csvEnum(TASK_KINDS).optional(),
  // Multi-tag is OR ("anything tagged travel or admin") — the reading users
  // expect from a filter chip row.
  tag: z.string().max(400).optional(),
  dueBefore: IsoDate.optional(),
  dueAfter: IsoDate.optional(),
  createdBefore: IsoDate.optional(),
  createdAfter: IsoDate.optional(),
  completedBefore: IsoDate.optional(),
  completedAfter: IsoDate.optional(),
  // Derived predicates the UI exposes as one-tap chips.
  overdue: QueryBool.optional(),
  undated: QueryBool.optional(),
  untagged: QueryBool.optional(),
})

export type TaskFilter = z.infer<typeof TaskFilterSchema>

// Escape user input before it reaches a RegExp. Without this, a stray `(` or
// `*` in a search box is either a 500 or a catastrophic-backtracking hazard.
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `find()` casts a string userId to an ObjectId from the schema; `aggregate()`
// does NOT — a raw string there silently matches nothing. Coerce once here so
// both query paths behave the same.
export function toUserObjectId(userId: string | Types.ObjectId): Types.ObjectId {
  return typeof userId === 'string' ? new Types.ObjectId(userId) : userId
}

// Translate a validated filter into a Mongo query, always scoped to one user
// and always excluding soft-deleted rows.
export function buildTaskFilter(
  userId: string | Types.ObjectId,
  f: TaskFilter,
  now: Date = new Date(),
): Record<string, unknown> {
  const filter: Record<string, unknown> = { userId: toUserObjectId(userId), ...notDeleted() }

  if (f.status) filter.status = { $in: f.status }
  if (f.domain) filter.domain = { $in: f.domain }
  if (f.priority) filter.priority = { $in: f.priority }
  if (f.kind) filter.kind = { $in: f.kind }

  if (f.tag) {
    const tags = f.tag
      .split(',')
      .map((t) => normalizeTag(t))
      .filter((t): t is string => Boolean(t))
    if (tags.length > 0) filter.tags = { $in: tags }
  }
  if (f.untagged) filter.tags = { $size: 0 }

  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i')
    filter.$or = [{ title: rx }, { notes: rx }]
  }

  // `overdue` and `undated` are mutually exclusive views of dueAt, and either
  // may combine with an explicit range — resolve them into one clause.
  const dueAt: Record<string, unknown> = {}
  if (f.dueBefore) dueAt.$lte = f.dueBefore
  if (f.dueAfter) dueAt.$gte = f.dueAfter
  if (f.overdue) {
    dueAt.$lt = dueAt.$lte && (dueAt.$lte as Date) < now ? (dueAt.$lte as Date) : now
    delete dueAt.$lte
    // Something already done isn't overdue, however stale its date.
    if (!f.status) filter.status = { $in: ['open', 'snoozed'] }
  }
  if (f.undated) {
    filter.dueAt = { $exists: false }
  } else if (Object.keys(dueAt).length > 0) {
    filter.dueAt = dueAt
  }

  const createdAt: Record<string, Date> = {}
  if (f.createdBefore) createdAt.$lte = f.createdBefore
  if (f.createdAfter) createdAt.$gte = f.createdAfter
  if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt

  const completedAt: Record<string, Date> = {}
  if (f.completedBefore) completedAt.$lte = f.completedBefore
  if (f.completedAfter) completedAt.$gte = f.completedAfter
  if (Object.keys(completedAt).length > 0) filter.completedAt = completedAt

  return filter
}

function sortStage(sort: TaskSort): Record<string, 1 | -1> {
  switch (sort) {
    case 'due-desc':
      return { _dueSort: -1, createdAt: -1 }
    case 'created-desc':
      return { createdAt: -1 }
    case 'created-asc':
      return { createdAt: 1 }
    case 'priority-desc':
      return { _priSort: -1, _dueSort: 1 }
    case 'title-asc':
      return { title: 1 }
    case 'due-asc':
    default:
      return { _dueSort: 1, createdAt: -1 }
  }
}

// The opaque page token. It encodes an offset — honest for this scale (a
// personal backlog, not a feed) and correct under every sort above, which a
// keyset cursor would not be without a unique tiebreaker per sort. Opaque so
// the implementation can become keyset later without touching the client.
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  const raw = Buffer.from(cursor, 'base64url').toString('utf8')
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export interface ListTasksResult {
  tasks: TaskDoc[]
  total: number
  nextCursor: string | null
}

// One round trip for both the page and the total, so the header count can never
// disagree with the rows beneath it.
export async function listTasks(
  userId: string | Types.ObjectId,
  filter: TaskFilter,
  opts: { sort?: TaskSort; limit: number; cursor?: string; now?: Date } = { limit: 50 },
): Promise<ListTasksResult> {
  const now = opts.now ?? new Date()
  const sort = opts.sort ?? DEFAULT_TASK_SORT
  const offset = decodeCursor(opts.cursor)
  const match = buildTaskFilter(userId, filter, now)

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $addFields: {
        _dueSort: { $ifNull: ['$dueAt', sort === 'due-desc' ? FAR_PAST : FAR_FUTURE] },
        _priSort: {
          $switch: {
            branches: Object.entries(PRIORITY_RANK).map(([priority, rank]) => ({
              case: { $eq: ['$priority', priority] },
              then: rank,
            })),
            default: PRIORITY_RANK.normal,
          },
        },
      },
    },
    {
      $facet: {
        rows: [
          { $sort: sortStage(sort) },
          { $skip: offset },
          { $limit: opts.limit },
          { $unset: ['_dueSort', '_priSort'] },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]

  const [facet] = await Task.aggregate(pipeline)
    // Case-insensitive title sort; harmless for the other sorts.
    .collation({ locale: 'en', strength: 2 })

  const rows = (facet?.rows ?? []) as Record<string, unknown>[]
  const total = (facet?.total?.[0]?.n as number | undefined) ?? 0
  const consumed = offset + rows.length

  return {
    // Aggregation returns plain objects — rehydrate so callers get the same
    // `toJSON()` (id mapping, priorityRank) as every other Task read.
    tasks: rows.map((r) => Task.hydrate(r)),
    total,
    nextCursor: consumed < total ? encodeCursor(consumed) : null,
  }
}

// ---- Time buckets ----

// Wall-clock day boundaries in the caller's IANA zone, expressed as UTC
// instants. Uses the same Intl round-trip as `modules/ai/timeNormalize.ts`
// rather than a naive UTC-midnight assumption, which would put "today" in the
// wrong place for most of the world.
export function zoneOffsetMinutes(at: Date, timezone: string | undefined): number {
  if (!timezone) return 0
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(at)
  const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const m = name.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!m) return 0
  return (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]))
}

export function startOfLocalDay(at: Date, timezone: string | undefined): Date {
  const offsetMin = zoneOffsetMinutes(at, timezone)
  const shifted = new Date(at.getTime() + offsetMin * 60_000)
  const midnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  )
  return new Date(midnightUtc - offsetMin * 60_000)
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 24 * 60 * 60 * 1000)
}

export interface DayBoundaries {
  todayStart: Date
  tomorrowStart: Date
  dayAfterTomorrowStart: Date
  weekEnd: Date
}

export function dayBoundaries(now: Date, timezone: string | undefined): DayBoundaries {
  const todayStart = startOfLocalDay(now, timezone)
  return {
    todayStart,
    tomorrowStart: addDays(todayStart, 1),
    dayAfterTomorrowStart: addDays(todayStart, 2),
    // "This week" means the next 7 days, not the calendar week — a Sunday-night
    // view of a calendar week is empty and useless.
    weekEnd: addDays(todayStart, 7),
  }
}
