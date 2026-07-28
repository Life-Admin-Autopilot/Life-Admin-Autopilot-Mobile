// Natural-language eval harness for Kitto.
//
// Calls REAL Gemini through the same streamPersonal + system prompt +
// prefill that production users hit. For each case we build the same
// "=== NOW === / === MY TASKS === / ..." scaffold the contextBuilder
// produces in real chat, then assert on the tool calls Kitto emits.
//
// Run with `npm run nl-eval` from the server/ directory. Requires
// GEMINI_API_KEY in server/.env. Costs ~$0.06 per full run.

import 'dotenv/config'

import type { Content } from '@google/genai'

import { isAiConfigured, getGeminiClient } from '../src/modules/ai/provider/geminiClient'
import { streamPersonal } from '../src/modules/ai/provider/streamPersonal'
import { getPrefillContents, getSystemPrompt } from '../src/modules/ai/voice'

// ─── Types ───────────────────────────────────────────────────────────────

interface FakeTask {
  id: string
  title: string
  domain: string
  status: 'open' | 'done' | 'snoozed'
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  dueAt?: string // ISO
  notes?: string
  tags?: string[]
  subtasks?: Array<{ id: string; text: string; done: boolean }>
}

interface ExpectedTool {
  name: string
  // Subset of args we care about for this case. Title is checked as a
  // case-insensitive substring; priority/domain/status are exact; arrays
  // require all expected items present (order-independent).
  args?: Record<string, unknown>
}

interface EvalCase {
  category: string
  prompt: string
  tasks?: FakeTask[]
  expect: {
    // Pass when the union of model tool calls satisfies ALL `tools`. Use
    // an empty array to assert NO tool calls.
    tools?: ExpectedTool[]
    // Tool names that must NOT appear at all. Lets a case assert the model
    // HELD (holdForClarification) and did NOT silently guess (createTask),
    // or that it just created without over-asking.
    forbidTools?: string[]
    // Optional substring (case-insensitive) the model's text reply must
    // contain — useful for "decline / clarify" cases.
    textIncludes?: string
  }
}

interface CaseOutcome {
  case: EvalCase
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
  text: string
  pass: boolean
  reasons: string[]
}

// ─── Cases ───────────────────────────────────────────────────────────────

const TASK_A: FakeTask = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Old gym membership',
  domain: 'health',
  status: 'open',
  priority: 'normal',
}
const TASK_B: FakeTask = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  title: 'Pay water bill',
  domain: 'home',
  status: 'open',
  priority: 'normal',
}
const TASK_C: FakeTask = {
  id: 'cccccccccccccccccccccccc',
  title: 'Renew passport',
  domain: 'family',
  status: 'open',
  priority: 'normal',
  subtasks: [
    { id: 'sub111111111111111111111a', text: 'gather birth certificate', done: false },
    { id: 'sub222222222222222222222b', text: 'take new photo', done: false },
  ],
}

const CASES: EvalCase[] = [
  // ── PRIORITY: paraphrased ──────────────────────────────────────────
  {
    category: 'PRIORITY',
    prompt: 'add a task to fix the kitchen sink, water is everywhere, I need this done today',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'urgent' } }],
    },
  },
  {
    category: 'PRIORITY',
    prompt: 'add a task to organize the garage when I get to it, no rush',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'low' } }],
    },
  },
  {
    category: 'PRIORITY',
    prompt: 'fix the leak under the bathroom sink, I am in a rush',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'high' } }],
    },
  },
  {
    category: 'PRIORITY',
    prompt: 'add buy birthday card for mom — whenever, her birthday is in November',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'family', priority: 'low' } }],
    },
  },
  {
    category: 'PRIORITY',
    prompt: 'add pay the gas bill before they cut me off',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'finance', priority: 'urgent' } }],
    },
  },
  {
    category: 'PRIORITY_ANTI_CUE',
    prompt: 'I had an emergency last week, anyway add a task to clean the gutters this weekend',
    expect: {
      // "emergency" appears but is narrative, not directive. Should be normal.
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'normal' } }],
    },
  },

  // ── DOMAIN: indirect ──────────────────────────────────────────────
  {
    category: 'DOMAIN',
    prompt: 'add a task to book Buddy in for his annual checkup next month',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'pets' } }],
    },
  },
  {
    category: 'DOMAIN',
    prompt: 'add a task to file my Q3 taxes',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'finance' } }],
    },
  },
  {
    category: 'DOMAIN',
    prompt: 'add a task to take the car in for an oil change',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'car' } }],
    },
  },
  {
    category: 'DOMAIN',
    prompt: 'add a task to call mom about thanksgiving plans',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'family' } }],
    },
  },
  {
    category: 'DOMAIN_TRICKY',
    prompt: 'add a task to refill my blood pressure prescription',
    expect: {
      // Borderline — could be health or home. Prefer health since it's medication.
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },

  // ── SUBTASKS vs NOTES ─────────────────────────────────────────────
  {
    category: 'SUBTASKS',
    prompt: 'for the passport renewal, what papers do I actually need? break it into steps',
    tasks: [TASK_C],
    expect: {
      // Should fire MULTIPLE addSubtask calls.
      tools: [
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
      ],
    },
  },
  {
    category: 'SUBTASKS',
    prompt: 'for the passport, list out what I need to bring to the appointment',
    tasks: [TASK_C],
    expect: {
      tools: [
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
      ],
    },
  },
  {
    category: 'NOTES',
    prompt:
      'for the water bill task, add a note: auto-pay is set up but check the statement for the meter reading before the 15th',
    tasks: [TASK_B],
    expect: {
      tools: [{ name: 'updateTask', args: { taskId: TASK_B.id } }],
    },
  },
  {
    category: 'SUBTASKS_AMBIGUOUS',
    prompt: 'I already grabbed the birth certificate for the passport, mark that step done',
    tasks: [TASK_C],
    expect: {
      tools: [
        {
          name: 'toggleSubtask',
          args: { taskId: TASK_C.id, subtaskId: TASK_C.subtasks![0].id },
        },
      ],
    },
  },

  // ── TAGS ──────────────────────────────────────────────────────────
  {
    category: 'TAGS',
    prompt: 'add a task to book a dentist for the twins',
    expect: {
      tools: [
        {
          name: 'createTask',
          args: { domain: 'health' },
        },
      ],
      // Soft expectation — Kitto MAY add a tag like 'kids' or 'twins'; we won't
      // hard-fail if it doesn't.
    },
  },
  {
    category: 'TAGS',
    prompt: "tag the water bill with 'recurring' and 'utilities'",
    tasks: [TASK_B],
    expect: {
      tools: [
        {
          name: 'updateTask',
          args: { taskId: TASK_B.id, tags: ['recurring', 'utilities'] },
        },
      ],
    },
  },
  {
    category: 'TAGS_NORMALIZE',
    prompt: 'tag the passport task with "International Travel" and "Q3 2026"',
    tasks: [TASK_C],
    expect: {
      // Server normalizes — but does the model emit something the
      // server will accept? Just check name; normalization is server-side.
      tools: [{ name: 'updateTask', args: { taskId: TASK_C.id } }],
    },
  },

  // ── STATUS / SNOOZE ───────────────────────────────────────────────
  {
    category: 'STATUS',
    prompt: 'I already cancelled the gym membership, mark that done',
    tasks: [TASK_A],
    expect: {
      tools: [{ name: 'completeTask', args: { taskId: TASK_A.id } }],
    },
  },
  {
    category: 'SNOOZE',
    prompt: 'push the water bill task to next Monday, I cannot deal with it this week',
    tasks: [TASK_B],
    expect: {
      tools: [{ name: 'snoozeTask', args: { taskId: TASK_B.id } }],
    },
  },
  {
    category: 'DELETE',
    prompt: "actually scratch the gym task — I'm not doing it anymore, just delete it",
    tasks: [TASK_A],
    expect: {
      tools: [{ name: 'deleteTask', args: { taskId: TASK_A.id } }],
    },
  },

  // ── MULTI-FIELD COMBO ────────────────────────────────────────────
  {
    category: 'MULTI_FIELD',
    prompt: 'rush job — fix the leaky pipe under the kitchen sink, water everywhere, need it done today',
    expect: {
      tools: [
        {
          name: 'createTask',
          args: { domain: 'home', priority: 'urgent' },
        },
      ],
    },
  },
  {
    category: 'MULTI_FIELD',
    prompt: 'add a task to grab birthday gift for mom, no rush, her birthday is November 15th',
    expect: {
      tools: [
        {
          name: 'createTask',
          args: { domain: 'family', priority: 'low' },
        },
      ],
    },
  },

  // ── MULTI-STEP (the Phase 8 fix) ────────────────────────────────
  {
    category: 'MULTI_STEP',
    prompt:
      'delete the gym task — I cancelled it last week. And add a new one to schedule dentist cleaning, due next Tuesday at 10am.',
    tasks: [TASK_A],
    expect: {
      // Both tools should be planned in this turn. createTask may run inline
      // OR be queued; we accept either ordering.
      tools: [
        { name: 'deleteTask', args: { taskId: TASK_A.id } },
        { name: 'createTask', args: { domain: 'health' } },
      ],
    },
  },
  {
    category: 'MULTI_STEP',
    prompt: 'mark the water bill task urgent and tag it recurring',
    tasks: [TASK_B],
    expect: {
      // Both updates SHOULD collapse into a single updateTask with both
      // fields. Accept either one call with both fields, or two calls.
      tools: [{ name: 'updateTask', args: { taskId: TASK_B.id, priority: 'urgent' } }],
    },
  },

  // ── NEGATIVE / NO-TOOL ───────────────────────────────────────────
  {
    category: 'NEGATIVE',
    prompt: "my task list feels overwhelming, I can't keep up",
    expect: { tools: [] }, // no tool — this is a vent, not a request
  },
  {
    category: 'NEGATIVE',
    prompt: "what's the difference between snoozing a task and marking it done?",
    expect: { tools: [] }, // chitchat, no tool
  },
  {
    category: 'QUERY',
    prompt: 'show me everything due this week',
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      tools: [{ name: 'queryTasks' }],
    },
  },

  // ── UNCERTAINTY: hold-and-ask, never guess ──────────────────────
  // The core trust feature. An uncertain item must be HELD (holdForClarification)
  // and asked about — NEVER silently created with a guessed value. And a casual
  // item must NOT be held (over-asking makes admin more stressful, not less).
  {
    category: 'CLARIFY_UNSURE_DATE',
    prompt: "i should see the doctor on the 17th or the 19th, im not sure",
    expect: {
      // Must hold and ask which date; must NOT pick one and "save" it.
      tools: [{ name: 'holdForClarification', args: { kind: 'date' } }],
      forbidTools: ['createTask'],
    },
  },
  {
    category: 'CLARIFY_UNSURE_DATE',
    prompt: 'renew the car registration — next friday or the friday after, cant remember which',
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'date' } }],
      forbidTools: ['createTask'],
    },
  },
  {
    category: 'CLARIFY_MISSING_TIME',
    prompt: 'remind me to call the dentist to book a cleaning',
    expect: {
      // Time-sensitive (appointment) with no time → ask "when?", don't save dateless.
      tools: [{ name: 'holdForClarification' }],
      forbidTools: ['createTask'],
    },
  },
  {
    category: 'CLARIFY_ANTI_OVERASK',
    prompt: 'add buy bread, no rush',
    expect: {
      // Casual, no time → just create. Asking "when?" here would be over-asking.
      tools: [{ name: 'createTask', args: { domain: 'home' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'CLARIFY_ANTI_OVERASK',
    prompt: 'add a task to wash the car this weekend sometime',
    expect: {
      // Soft-but-single date is CLEAR → create with a best date, do not hold.
      tools: [{ name: 'createTask', args: { domain: 'car' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'CLARIFY_MIX',
    prompt:
      'pay the rent on the first, and renew my gym membership — i think july? or maybe august, not sure',
    expect: {
      // Create the clear one (rent) AND hold the unsure one (gym), same turn.
      tools: [
        { name: 'createTask', args: { domain: 'finance' } },
        { name: 'holdForClarification', args: { kind: 'date' } },
      ],
    },
  },

  // ── HOLD-OUT CASES ──────────────────────────────────────────────
  // Added AFTER prefill tuning to detect overfitting. Each case tests the
  // SAME principle as a tuned-for failure, but with different surface
  // wording, topic, and verbs. If the prefill is learning the principle
  // (not memorizing examples) these should pass at a similar rate to the
  // organic categories above.

  {
    // Principle: low-priority cue + dated future event (analog to PRIORITY #4
    // and prefill turn 5). Different wording: "take your time" + "deadline" +
    // domain that's NOT family/home.
    category: 'HOLDOUT_PRIORITY_DATE',
    prompt:
      'add submit my expense report, take your time on it, deadline is end of next month',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'finance', priority: 'low' } }],
    },
  },
  {
    // Principle: same as above. Different wording: "low key" + future date.
    category: 'HOLDOUT_PRIORITY_DATE',
    prompt:
      'add a task to schedule my annual physical, low key whenever, anytime in the next three months',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health', priority: 'low' } }],
    },
  },
  {
    // Principle: open-ended "what do I need to prep" → multiple addSubtask
    // (analog to SUBTASKS #1 and prefill turn 6). Different topic (dinner
    // party not passport/move), different verb ("prep" not "list out").
    category: 'HOLDOUT_SUBTASKS',
    prompt: "for the renew passport task, what do I need to prep? walk me through it",
    tasks: [TASK_C],
    expect: {
      tools: [
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
      ],
    },
  },
  {
    // Principle: priority paraphrase NOT in prefill. "don't drop the ball"
    // should map to high (urgent-leaning).
    category: 'HOLDOUT_PRIORITY_PARAPHRASE',
    prompt: "add pay rent — don't drop the ball on this one",
    expect: {
      // Either high or urgent is acceptable — both signal "important". The
      // matcher will FAIL this if Kitto picks normal/low.
      tools: [{ name: 'createTask', args: { domain: 'finance', priority: 'high' } }],
    },
  },
  {
    // Principle: domain inference for a niche concrete item.
    category: 'HOLDOUT_DOMAIN',
    prompt: 'add a task to buy formula for the baby',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'family' } }],
    },
  },
  {
    // Principle: tag inference when user EXPLICITLY names tags. Should
    // emit both — not just one — and apply lowercase-kebab.
    category: 'HOLDOUT_TAGS',
    prompt:
      'add finish the Q3 quarterly report, tag it as work and reporting, priority high',
    expect: {
      tools: [
        {
          name: 'createTask',
          args: {
            priority: 'high',
            tags: ['work', 'reporting'],
          },
        },
      ],
    },
  },

  // ── MULTI-LANGUAGE CASES ────────────────────────────────────────
  // Phase 1 baseline: zero prompt tuning for non-English. We're
  // measuring what Gemini does out of the box so the Phase 2 prompt
  // changes can target real failures. Per research (arxiv 2601.05101),
  // tool schemas stay English; argument VALUES (titles, notes) should
  // preserve in user's language but we don't assert that here — we
  // assert the structured fields (domain enum, priority enum) which
  // ARE supposed to stay English per our schema.

  // ── Spanish ─────────────────────────────────────────────────────
  {
    category: 'ES_PRIORITY_LOW',
    prompt: 'agregar tarea: comprar pan, no hay prisa',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'low' } }],
    },
  },
  {
    category: 'ES_DOMAIN',
    prompt: 'agendar cita con el dentista mañana a las 10',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },
  {
    category: 'ES_QUERY',
    prompt: '¿qué tengo pendiente esta semana?',
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      tools: [{ name: 'queryTasks' }],
    },
  },
  {
    category: 'ES_PRIORITY_URGENT',
    prompt:
      'agregar pagar el alquiler — esto es urgente, vence mañana',
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'finance', priority: 'urgent' } },
      ],
    },
  },
  {
    category: 'ES_MULTI_STEP',
    prompt: 'borra la tarea del gimnasio y agrega una nueva: llamar al dentista mañana',
    tasks: [TASK_A],
    expect: {
      tools: [
        { name: 'deleteTask', args: { taskId: TASK_A.id } },
        { name: 'createTask', args: { domain: 'health' } },
      ],
    },
  },

  // ── French ──────────────────────────────────────────────────────
  {
    category: 'FR_PRIORITY_LOW',
    prompt: 'ajoute une tâche pour acheter du pain, pas pressé',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'low' } }],
    },
  },
  {
    category: 'FR_DOMAIN',
    prompt: 'prendre rendez-vous chez le médecin demain à 10h',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },
  {
    category: 'FR_QUERY',
    prompt: "qu'est-ce que j'ai cette semaine?",
    expect: {
      tools: [{ name: 'queryTasks' }],
    },
  },
  {
    category: 'FR_PRIORITY_URGENT',
    prompt:
      "payer la facture d'électricité avant qu'ils coupent le courant",
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'finance', priority: 'urgent' } },
      ],
    },
  },
  {
    category: 'FR_DATE',
    prompt: "rappelle-moi d'appeler maman le 15 novembre",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'family' } }],
    },
  },

  // ── Arabic (MSA) ────────────────────────────────────────────────
  {
    category: 'AR_PRIORITY_LOW',
    prompt: 'أضف مهمة لشراء الخبز، لا داعي للعجلة',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home', priority: 'low' } }],
    },
  },
  {
    category: 'AR_DOMAIN',
    prompt: 'حدد موعداً مع الطبيب غداً الساعة العاشرة صباحاً',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },
  {
    category: 'AR_QUERY',
    prompt: 'ماذا لدي من مهام هذا الأسبوع؟',
    expect: {
      tools: [{ name: 'queryTasks' }],
    },
  },
  {
    category: 'AR_PRIORITY_URGENT',
    prompt: 'ادفع فاتورة الكهرباء قبل أن ينقطع التيار',
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'finance', priority: 'urgent' } },
      ],
    },
  },
  {
    category: 'AR_DATE',
    prompt: 'ذكّرني بشراء هدية لأمي يوم ١٥ نوفمبر',
    expect: {
      // Eastern Arabic numerals (١٥) in the date — Phase 3 will
      // normalize these server-side, but we check now if Gemini already
      // does it implicitly.
      tools: [{ name: 'createTask', args: { domain: 'family' } }],
    },
  },

  // ── Code-switched (mixed English mid-sentence) ─────────────────
  {
    category: 'CS_ES_EN',
    prompt: 'agregar task para llamar al doctor mañana',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },
  {
    category: 'CS_AR_EN',
    prompt: 'اضف task جديدة لمراجعة الطبيب غداً',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
    },
  },
  {
    category: 'CS_AR_EN_PRIORITY',
    prompt: 'اعمل remind لي ان ادفع فاتورة الكهرباء، urgent',
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'finance', priority: 'urgent' } },
      ],
    },
  },
]

// ─── Context builder (mirrors the production scaffold) ───────────────────

function nowIsoLocal(): string {
  // Local time with offset, the same shape contextBuilder.formatNow produces.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

function renderTaskBlock(tasks: FakeTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '(no open tasks)'
  return tasks
    .map((t) => {
      const due = t.dueAt ? ` — due ${t.dueAt}` : ''
      const prio = t.priority && t.priority !== 'normal' ? ` — ${t.priority}` : ''
      const tags =
        t.tags && t.tags.length > 0 ? ` — tags: ${t.tags.join(', ')}` : ''
      const lines = [`[task:${t.id}] ${t.title}${due} — ${t.domain} — ${t.status}${prio}${tags}`]
      for (const s of t.subtasks ?? []) {
        lines.push(`    ${s.done ? '[x]' : '[ ]'} <subtask:${s.id}> ${s.text}`)
      }
      if (t.notes) lines.push(`    notes: ${t.notes}`)
      return lines.join('\n')
    })
    .join('\n')
}

function buildContents(c: EvalCase): Content[] {
  const taskBlock = renderTaskBlock(c.tasks)
  const user = [
    `=== NOW ===`,
    nowIsoLocal(),
    `=== MY TASKS ===`,
    taskBlock,
    `=== RECENT VOICE NOTES ===`,
    '(none)',
    `=== END ===`,
    c.prompt,
  ].join('\n')

  return [...getPrefillContents(), { role: 'user', parts: [{ text: user }] }]
}

// ─── Matcher ─────────────────────────────────────────────────────────────

// Server-side defaults — if the model omits a key that the server fills in
// to this value, count it as equivalent. Prevents penalizing Kitto for not
// being redundant with the schema default.
const SERVER_DEFAULTS: Record<string, unknown> = {
  priority: 'normal',
  status: 'open',
}

function argsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } {
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key]

    if (key === 'title' && typeof want === 'string') {
      // Case-insensitive substring match.
      if (typeof got !== 'string' || !got.toLowerCase().includes(want.toLowerCase())) {
        return { ok: false, reason: `title "${String(got)}" missing "${want}"` }
      }
      continue
    }

    if (Array.isArray(want)) {
      if (!Array.isArray(got)) {
        return { ok: false, reason: `${key} not an array (got ${JSON.stringify(got)})` }
      }
      for (const item of want) {
        if (typeof item === 'string') {
          const hit = got.some(
            (g) => typeof g === 'string' && g.toLowerCase().includes(item.toLowerCase()),
          )
          if (!hit) return { ok: false, reason: `${key}: missing "${item}"` }
        }
      }
      continue
    }

    // Treat an omitted key as equivalent to the server's default value.
    // e.g. expect `priority: 'normal'` matches `args` with no priority key.
    if (got === undefined && SERVER_DEFAULTS[key] === want) {
      continue
    }

    if (got !== want) {
      return { ok: false, reason: `${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}` }
    }
  }
  return { ok: true }
}

function matchTools(
  expected: ExpectedTool[],
  actual: Array<{ name: string; args: Record<string, unknown> }>,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []

  if (expected.length === 0) {
    if (actual.length > 0) {
      return {
        ok: false,
        reasons: [
          `expected NO tools, model fired ${actual.length}: ${actual.map((a) => a.name).join(', ')}`,
        ],
      }
    }
    return { ok: true }
  }

  // For each expected tool call we need at least one actual call with the
  // same name and matching subset of args. Each actual call can only
  // satisfy one expectation.
  const claimed = new Set<number>()
  for (const want of expected) {
    let satisfied = false
    for (let i = 0; i < actual.length; i++) {
      if (claimed.has(i)) continue
      const act = actual[i]
      if (!act) continue
      if (act.name !== want.name) continue
      if (want.args) {
        const m = argsMatch(want.args, act.args)
        if (!m.ok) continue
      }
      claimed.add(i)
      satisfied = true
      break
    }
    if (!satisfied) {
      const argDesc = want.args ? ` with ${JSON.stringify(want.args)}` : ''
      reasons.push(`missing ${want.name}${argDesc}`)
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

// ─── Runner ──────────────────────────────────────────────────────────────

async function runCase(c: EvalCase): Promise<CaseOutcome> {
  const client = getGeminiClient()
  const contents = buildContents(c)

  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  let text = ''

  for await (const ev of streamPersonal({
    client,
    systemInstruction: getSystemPrompt(),
    contents,
  })) {
    if (ev.kind === 'token') text += ev.text
    else if (ev.kind === 'tool_call') toolCalls.push({ name: ev.name, args: ev.args })
  }

  const m = matchTools(c.expect.tools ?? [], toolCalls)
  const reasons: string[] = m.ok ? [] : m.reasons

  for (const name of c.expect.forbidTools ?? []) {
    if (toolCalls.some((t) => t.name === name)) {
      reasons.push(`should NOT have called ${name}`)
    }
  }

  if (c.expect.textIncludes) {
    if (!text.toLowerCase().includes(c.expect.textIncludes.toLowerCase())) {
      reasons.push(`text missing "${c.expect.textIncludes}"`)
    }
  }

  return { case: c, toolCalls, text, pass: reasons.length === 0, reasons }
}

// ─── Reporting ───────────────────────────────────────────────────────────

const COLORS = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function printCase(i: number, total: number, out: CaseOutcome) {
  const verdict = out.pass ? COLORS.green('PASS') : COLORS.red('FAIL')
  const cat = out.case.category.padEnd(20)
  console.log(`\n[${i + 1}/${total}] ${cat} ${verdict}`)
  console.log(`  ${COLORS.dim('prompt:')} ${out.case.prompt}`)

  if (out.toolCalls.length === 0) {
    console.log(`  ${COLORS.dim('tools: ')} ${COLORS.yellow('(none)')}`)
  } else {
    for (const tc of out.toolCalls) {
      console.log(`  ${COLORS.dim('tool:  ')} ${COLORS.bold(tc.name)} ${JSON.stringify(tc.args)}`)
    }
  }

  if (out.text.trim().length > 0) {
    const preview = out.text.length > 160 ? `${out.text.slice(0, 160)}…` : out.text
    console.log(`  ${COLORS.dim('text:  ')} ${preview.replace(/\n/g, ' ')}`)
  }

  if (!out.pass) {
    for (const r of out.reasons) {
      console.log(`  ${COLORS.red('✗')} ${r}`)
    }
  }
}

function printSummary(outcomes: CaseOutcome[]) {
  const byCat = new Map<string, { pass: number; total: number }>()
  for (const o of outcomes) {
    const cat = o.case.category
    const row = byCat.get(cat) ?? { pass: 0, total: 0 }
    row.total++
    if (o.pass) row.pass++
    byCat.set(cat, row)
  }

  const passed = outcomes.filter((o) => o.pass).length
  const total = outcomes.length

  console.log(`\n${COLORS.bold('═══ Summary ═══')}\n`)
  for (const [cat, row] of [...byCat.entries()].sort()) {
    const pct = Math.round((row.pass / row.total) * 100)
    const bar = pct >= 80 ? COLORS.green(`${pct}%`) : pct >= 50 ? COLORS.yellow(`${pct}%`) : COLORS.red(`${pct}%`)
    console.log(`  ${cat.padEnd(22)} ${row.pass}/${row.total}  ${bar}`)
  }
  const overall = Math.round((passed / total) * 100)
  const overallColor =
    overall >= 90 ? COLORS.green : overall >= 70 ? COLORS.yellow : COLORS.red
  console.log(
    `\n  ${COLORS.bold('OVERALL'.padEnd(22))} ${passed}/${total}  ${overallColor(`${overall}%`)}\n`,
  )
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!isAiConfigured()) {
    console.error(
      COLORS.red('GEMINI_API_KEY is not set in server/.env. Aborting.'),
    )
    process.exit(1)
  }

  console.log(COLORS.bold(`\nRunning ${CASES.length} natural-language cases against real Gemini…\n`))
  console.log(COLORS.dim(`(temperature=default, prompt+prefill = production)\n`))

  const outcomes: CaseOutcome[] = []
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i]
    if (!c) continue
    try {
      const out = await runCase(c)
      outcomes.push(out)
      printCase(i, CASES.length, out)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.log(`\n[${i + 1}/${CASES.length}] ${c.category} ${COLORS.red('ERROR')}`)
      console.log(`  ${COLORS.dim('prompt:')} ${c.prompt}`)
      console.log(`  ${COLORS.red('✗')} ${message}`)
      outcomes.push({ case: c, toolCalls: [], text: '', pass: false, reasons: [message] })
    }
  }

  printSummary(outcomes)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
