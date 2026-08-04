// The CORE suite — one clean intent per prompt, checking that it maps to the
// right tool with the right arguments.
//
// Moved out of nl-eval.ts unchanged when the hard suite was added; the harness
// there had grown past 900 lines with these inline. The companion suite
// (cases.hard.ts) covers spoken, multi-intent and adversarial input.
//
// NOTE: the ES_* and FR_* cases predate the locale-driven language rule.
// AI_LOCALES is ['en','ar'], so a Spanish or French speaker is an English-locale
// account typing in another language — these now assert only that the INPUT is
// understood, which is still worth pinning. Reply language is covered by the
// LANG_* cases in the hard suite.

import type { EvalCase } from './types'
import { TASK_A, TASK_B, TASK_C } from './fixtures'

export const CORE_CASES: EvalCase[] = [
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
          args: { taskId: TASK_C.id, subtaskId: TASK_C.subtasks![0]!.id },
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
