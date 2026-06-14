import type { Content } from '@google/genai'

import { Task } from '../../models/Task'
import { VoiceNote } from '../../models/VoiceNote'
import { getPrefillContents, getSystemPrompt } from './voice'

// Three-tier router (Wiscord pattern):
//   greeting     — true conversation openers ("hi", "yo", "gm"). 0 history,
//                  0 data blocks. Bare user turn so a fresh hello can't
//                  inherit a prior bad reply via in-context learning.
//   conversation — small talk, vent, elliptical reactions. 6 history turns,
//                  no data blocks. Bare current turn matches the bare-text
//                  shape of every prior user turn so the model reads short
//                  follow-ups as continuations of the thread.
//   grounded     — data / scheduling intent. 11 history turns, structured
//                  current user turn (NOW + data blocks). Larger window
//                  because tool-use state needs more turns to unfold.
//
// SAFETY DEFAULT (fixes "tools fire without data"): the model is ALWAYS
// handed the full tool surface (streamPersonal attaches AI_TOOLS on every
// turn). If a task-acting message fell into `conversation` — which ships NO
// MY TASKS block — the model could call updateTask/deleteTask/completeTask
// with NO grounded task ids to source a verbatim [task:<id>] from, and would
// invent one. So `pickMode` is conservative: only a CLEAR greeting stays
// data-free. Everything else is `grounded` and gets the MY TASKS + NOW
// blocks before any tool can fire. The keyword regex is retained only as
// documentation of the strongest data signals; it no longer gates routing.

export type AiMode = 'greeting' | 'conversation' | 'grounded'

export interface ContextSource {
  kind: 'task' | 'voice'
  id: string
  title: string
}

export interface PersonalContext {
  system: string
  prefillContents: Content[]
  user: string
  sources: ContextSource[]
  mode: AiMode
}

const GREETING_RE =
  /^(hi+|hey+|yo+|sup|hello+|hola|howdy|heya|hiya|gm|gn|good\s+(morning|evening|night|afternoon))[\s!.?,]*$/i

// Retained as documentation of the strongest data signals. NO LONGER gates
// routing — see pickMode. Keywords map to Table 6 intents + Table 2 domains.
const DATA_KEYWORDS_RE =
  /\b(task|tasks|todo|todos|remind|reminder|add|create|update|change|move|cancel|delete|complete|done|snooze|due|deadline|today|tonight|tomorrow|this\s+week|next\s+week|overdue|health|home|car|finance|family|pets|insurance|registration|bill|appointment|prescription|warranty|passport|school|vet|when|what\'s|whats|show|list|my)\b/i

export function pickMode(question: string): AiMode {
  const trimmed = question.trim()
  // Empty / clear greeting → data-free, fast path. Empty falls through to
  // greeting too (an empty turn has no task intent).
  if (trimmed.length === 0) return 'greeting'
  if (trimmed.length <= 20 && GREETING_RE.test(trimmed)) return 'greeting'
  // Everything else is grounded by default so the model never reaches a
  // task-mutating tool without the MY TASKS data block in front of it. This
  // costs a tasks query on small talk, but the alternative — a deleteTask
  // fired against an invented id — is far worse. DATA_KEYWORDS_RE is kept
  // above for documentation; it intentionally does not branch here.
  void DATA_KEYWORDS_RE
  return 'grounded'
}

interface BuildArgs {
  userId: string
  question: string
  timezone?: string
}

const TASK_CAP = 20
const VOICE_CAP = 5

export async function buildPersonalContext(args: BuildArgs): Promise<PersonalContext> {
  const mode = pickMode(args.question)

  if (mode !== 'grounded') {
    return {
      system: getSystemPrompt(),
      prefillContents: getPrefillContents(),
      user: args.question,
      sources: [],
      mode,
    }
  }

  // Grounded: pull lean RAG-free signals scoped to the user.
  const [tasks, voiceNotes] = await Promise.all([
    Task.find({ userId: args.userId, status: { $in: ['open', 'snoozed'] } })
      .sort({ dueAt: 1, createdAt: -1 })
      .limit(TASK_CAP),
    VoiceNote.find({ userId: args.userId, status: 'ready' })
      .sort({ createdAt: -1 })
      .limit(VOICE_CAP),
  ])

  const sources: ContextSource[] = [
    ...tasks.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
    })),
    ...voiceNotes.map((v) => ({
      kind: 'voice' as const,
      id: v.id,
      title: (v.transcript ?? '').slice(0, 80) || 'Voice note',
    })),
  ]

  const nowIso = formatNow(args.timezone)
  const dateRef = buildDateReference(args.timezone)
  const taskBlock =
    tasks.length === 0
      ? '(no open tasks)'
      : tasks
          .map((t) => {
            const dueLabel = t.dueAt ? ` — due ${t.dueAt.toISOString()}` : ''
            const kindLabel = t.kind ? ` — ${t.kind}` : ''
            const priorityLabel = t.priority && t.priority !== 'normal' ? ` — ${t.priority}` : ''
            const tagsLabel =
              Array.isArray(t.tags) && t.tags.length > 0 ? ` — tags: ${t.tags.join(', ')}` : ''
            const lines: string[] = [
              `[task:${t.id}] ${t.title}${dueLabel} — ${t.domain}${kindLabel} — ${t.status}${priorityLabel}${tagsLabel}`,
            ]
            const subs = Array.isArray(t.subtasks) ? t.subtasks : []
            for (const s of subs) {
              const mark = s.done ? '[x]' : '[ ]'
              lines.push(`    ${mark} <subtask:${String(s._id)}> ${s.text}`)
            }
            if (t.notes) {
              const head = t.notes.slice(0, 240)
              lines.push(`    notes: ${head}${t.notes.length > 240 ? '…' : ''}`)
            }
            return lines.join('\n')
          })
          .join('\n')

  const voiceBlock =
    voiceNotes.length === 0
      ? '(no recent voice notes)'
      : voiceNotes
          .map((v) => {
            const head = (v.transcript ?? '').slice(0, 200)
            return `[voice:${v.id}] ${head}${head.length === 200 ? '…' : ''}`
          })
          .join('\n')

  const user = [
    `=== NOW ===`,
    nowIso,
    dateRef,
    `Resolve weekday phrases ("Friday", "next Tuesday", "this weekend") against the date table above — do NOT compute weekdays yourself. "next <weekday>" = the soonest upcoming one.`,
    `Reminders are for the FUTURE: never set a dueAt/until before today. If a phrase resolves to a past date (e.g. "last Monday"), use the next future occurrence instead, or ask.`,
    `A request to SEE / SHOW / LIST / VIEW your tasks ("show me everything", "what's on my plate", "what do I have") is READ-ONLY — answer it with queryTasks, NEVER deleteAllTasks. "everything" without a delete verb is not a delete.`,
    `Capture every CONCRETE actionable to-do, even softly phrased ("I should grab milk", "I need to call the bank at some point", "must remember to X") — file it with createTask as kind:'list' (no date). Only skip pure feelings / venting / aspirations ("I should get my life together"). EXCEPTION: time-sensitive no-date items (appointments, bills, renewals, expiries) are NOT casual — keep holding those for a date. When unsure whether something concrete is worth keeping, capture it.`,
    `=== MY TASKS ===`,
    taskBlock,
    `=== RECENT VOICE NOTES ===`,
    voiceBlock,
    `=== END ===`,
    args.question,
  ].join('\n')

  return {
    system: getSystemPrompt(),
    prefillContents: getPrefillContents(),
    user,
    sources,
    mode,
  }
}

function weekdayInTz(d: Date, timezone: string | undefined, style: 'long' | 'short'): string {
  return new Intl.DateTimeFormat('en-US', {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: style,
  }).format(d)
}

// Explicit weekday→date table for the next 14 days so the model resolves
// "next Friday" / "this weekend" by lookup instead of (error-prone) weekday
// arithmetic — the root cause of off-by-one due dates. Anchored to the local
// calendar date in `timezone`; iterated at UTC noon to stay clear of DST edges.
export function buildDateReference(timezone: string | undefined): string {
  const now = new Date()
  const ymd = new Intl.DateTimeFormat('en-CA', {
    ...(timezone ? { timeZone: timezone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) // YYYY-MM-DD (local)
  const parts = ymd.split('-').map((n) => Number(n))
  const y = parts[0] ?? new Date().getUTCFullYear()
  const m = parts[1] ?? 1
  const d = parts[2] ?? 1
  const isoOf = (day: Date): string =>
    `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`
  const lines: string[] = ['=== DATE REFERENCE (local) ===']
  for (let i = 0; i < 14; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i, 12, 0, 0))
    const wd = weekdayInTz(day, 'UTC', 'long')
    const tag = i === 0 ? '(today)' : i === 1 ? '(tomorrow)' : `(in ${i} days)`
    lines.push(`${wd} ${isoOf(day)} ${tag}`)
  }
  // Literal anchors for common relative phrases the model otherwise guesses.
  let sat = new Date(Date.UTC(y, m - 1, d, 12))
  for (let i = 0; i < 7; i++) {
    const cand = new Date(Date.UTC(y, m - 1, d + i, 12))
    if (weekdayInTz(cand, 'UTC', 'long') === 'Saturday') {
      sat = cand
      break
    }
  }
  const sun = new Date(sat.getTime() + 86_400_000)
  const eom = new Date(Date.UTC(y, m, 0, 12)) // day 0 of next month = last of this
  lines.push('--- phrase anchors (resolve these literally) ---')
  lines.push(`this weekend = Sat ${isoOf(sat)} & Sun ${isoOf(sun)}`)
  lines.push(`end of this month = ${isoOf(eom)}`)
  return lines.join('\n')
}

export function formatNow(timezone: string | undefined): string {
  if (!timezone) return `${new Date().toISOString()} (${weekdayInTz(new Date(), undefined, 'long')})`
  // ISO-style local timestamp with offset, suitable for grounding the model's
  // relative-time parsing ("tomorrow 9am").
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(now)
  const offset =
    offsetParts.find((p) => p.type === 'timeZoneName')?.value?.replace('GMT', '') || '+00:00'
  const weekday = weekdayInTz(now, timezone, 'long')
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset} (${weekday})`
}
