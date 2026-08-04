// The HARD suite — 50 cases built to break Kitto rather than to confirm it.
//
// The core suite (cases.core.ts) checks that a clean, single-intent sentence
// maps to the right tool. These do the opposite: every prompt is spoken rather
// than typed — filler, self-interruption, mid-sentence retraction, several
// intents jammed into one breath — and every case carries a `trap`, the
// specific wrong answer it exists to catch.
//
// The rules under test all live in voice/toolRules.ts:
//   - MULTI-STEP: N intents in one message = N calls in one turn, no narrating
//   - UNCERTAINTY: hold what is expensive to guess, create everything else
//   - anti-overask: a card on a casual item is a bug, not caution
//   - bulk delete is ONE call, and the only one that pauses
//   - urgent + no date is a contradiction that must never persist
//   - LANGUAGE: the user's Settings locale decides, not the prompt's language
//
// Assertions stay on what the prompt actually mandates. Where a rule genuinely
// admits two right answers (`anyOf`), both are accepted — an eval that fails a
// model for choosing the other sanctioned branch teaches the wrong lesson.

import type { EvalCase } from './types'
import {
  TASK_A,
  TASK_B,
  TASK_C,
  TASK_CAR_INSURANCE,
  TASK_CAR_SERVICE,
  TASK_DENTIST,
  TASK_HEALTH_INSURANCE,
  TASK_LANDLORD,
  TASK_MOVE,
} from './fixtures'

export const HARD_CASES: EvalCase[] = [
  // ══ A. MULTI-INTENT — several things in one breath ═══════════════════════
  // The failure this group hunts: the model narrates "first I'll add the bill,
  // then…" and emits one call. Everything after the first intent is lost, and
  // the user only finds out days later when nothing fires.
  {
    category: 'MULTI_INTENT',
    trap: 'Middle intents get dropped; the casual one (milk) gets held.',
    prompt:
      "okay so uh — pay the electric bill on the first, that one's set. and I need to renew my passport, I think it expires in like... november? maybe october, I genuinely don't remember. oh and mark the dentist thing as done, I went yesterday. also add milk to the shopping whenever, no rush. and email that guy about the thing — he knows which one.",
    tasks: [TASK_DENTIST],
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'finance' } },
        { name: 'createTask', args: { domain: 'home' } },
        { name: 'completeTask', args: { taskId: TASK_DENTIST.id } },
        { name: 'holdForClarification', args: { kind: 'date' } },
        { name: 'holdForClarification', args: { kind: 'detail' } },
      ],
      // Exactly two holds: the passport and the email. A third means the milk
      // was held too — over-asking on the one item that needed nothing.
      toolCounts: { holdForClarification: { min: 2, max: 2 }, completeTask: { min: 1, max: 1 } },
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'Two holds must both fire in the same turn as the two creates.',
    prompt:
      "right so — book the dentist sometime, renew my passport, I've no idea when it actually expires, email that guy about the thing, and put the bins out tonight",
    expect: {
      toolCounts: {
        createTask: { min: 2 },
        holdForClarification: { min: 2, max: 2 },
      },
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'Three flat intents — the middle one is the one that vanishes.',
    prompt:
      "add three things for me: pick up the dry cleaning friday, book Buddy in for his vaccination, and pay the internet bill on the 3rd",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'pets' } }],
      toolCounts: { createTask: { min: 3 } },
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'The bulk wipe pauses; the trailing create must survive the pause.',
    prompt: "clear out all my finance stuff, it's a mess — and add buy bread",
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      tools: [{ name: 'deleteAllTasks' }, { name: 'createTask' }],
      toolCounts: { deleteAllTasks: { min: 1, max: 1 }, deleteTask: { max: 0 } },
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'Three different domains inferred from one unpunctuated ramble.',
    prompt:
      "ok um, the cat needs her flea treatment, my MOT is due on the 12th, and I keep forgetting to send my sister her birthday card",
    expect: {
      tools: [
        { name: 'createTask', args: { domain: 'pets' } },
        { name: 'createTask', args: { domain: 'car' } },
        { name: 'createTask', args: { domain: 'family' } },
      ],
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'A read, an edit and a create in one turn — models do the read only.',
    prompt:
      "what have I got this week? also bump the water bill to urgent, and add collect the parcel tomorrow",
    tasks: [TASK_B],
    expect: {
      tools: [
        { name: 'queryTasks' },
        { name: 'updateTask', args: { taskId: TASK_B.id, priority: 'urgent' } },
        { name: 'createTask' },
      ],
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'Six casual items — a hold on any of them is over-asking.',
    prompt: "shopping list: bread, milk, eggs, bin bags, cat food, and washing up liquid",
    expect: {
      toolCounts: { createTask: { min: 1 }, holdForClarification: { max: 0 } },
    },
  },
  {
    category: 'MULTI_INTENT',
    trap: 'Two breakdown requests — the second task gets forgotten.',
    prompt: "break down the passport one for me, and also what do I need for the move?",
    tasks: [TASK_C, TASK_MOVE],
    expect: {
      tools: [
        { name: 'addSubtask', args: { taskId: TASK_C.id } },
        { name: 'addSubtask', args: { taskId: TASK_MOVE.id } },
      ],
      toolCounts: { addSubtask: { min: 4 } },
    },
  },

  // ══ B. RETRACTION — the user changes their mind mid-sentence ═════════════
  // Spoken input corrects itself constantly. The abandoned value sits earlier
  // in the string and is often the more emphatic one, so it wins on attention
  // and loses on truth.
  {
    category: 'RETRACTION',
    trap: 'Filing the abandoned date, then patching it with a second call.',
    prompt:
      "add a reminder to call the landlord tomorrow at 6 — no wait, he's away tomorrow, make it thursday",
    expect: {
      toolCounts: { createTask: { min: 1, max: 1 }, updateTask: { max: 0 } },
    },
  },
  {
    category: 'RETRACTION',
    trap: 'The retracted priority is the emphatic one; it must not stick.',
    prompt:
      "add sort out the recycling — actually make it urgent, no wait, it's honestly not that bad, normal is fine",
    expect: {
      toolCounts: { createTask: { min: 1, max: 1 } },
      forbidArgs: [{ name: 'createTask', args: { priority: 'urgent' } }],
    },
  },
  {
    category: 'RETRACTION',
    trap: 'A destructive verb retracted into a read. Deleting here is data loss.',
    prompt: "cancel the gym membership — actually hold on, did I already cancel it? just check first",
    tasks: [TASK_A],
    expect: {
      tools: [{ name: 'queryTasks' }],
      forbidTools: ['deleteTask', 'deleteAllTasks', 'completeTask'],
    },
  },
  {
    category: 'RETRACTION',
    trap: 'A bulk wipe narrowed to one item mid-sentence.',
    prompt: "delete all my tasks — no no, sorry, just the gym one",
    tasks: [TASK_A, TASK_B],
    expect: {
      tools: [{ name: 'deleteTask', args: { taskId: TASK_A.id } }],
      forbidTools: ['deleteAllTasks'],
    },
  },
  {
    category: 'RETRACTION',
    trap: 'Abandoned item created anyway alongside the real one.',
    prompt:
      "add pick up my prescription... actually never mind, I collected it already. But do add order more contact lenses",
    expect: {
      toolCounts: { createTask: { min: 1, max: 1 } },
      forbidArgs: [{ name: 'createTask', args: { title: 'prescription' } }],
    },
  },
  {
    category: 'RETRACTION',
    trap: 'A self-correction is NOT uncertainty — holding here is over-asking.',
    prompt: "book the dentist for the 15th, sorry I mean the 16th",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
      forbidTools: ['holdForClarification'],
    },
  },

  // ══ C. HOLD REQUIRED — expensive to guess ════════════════════════════════
  {
    category: 'HOLD_REQUIRED',
    trap: 'Silently picking the 3rd. A missed flight is unrecoverable.',
    prompt: "the flight's either the 3rd or the 4th of next month, I need to sort the airport parking",
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'date' } }],
      toolCounts: { createTask: { max: 0 } },
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'Guessing a date for a visa expiry — a legal cliff, not a nudge.',
    prompt: "my visa expires sometime in spring, I need to start the renewal",
    expect: {
      tools: [{ name: 'holdForClarification' }],
      toolCounts: { createTask: { max: 0 } },
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'Inventing a who and a what rather than asking for both at once.',
    prompt: "email that guy about the thing — he knows which one",
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'detail' } }],
      toolCounts: { holdForClarification: { min: 1, max: 1 } },
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'A court date guessed wrong has legal consequences.',
    prompt: "I have to be in court, it's either the 12th or the 19th, I can't remember which",
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'date' } }],
      toolCounts: { createTask: { max: 0 } },
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'TWO plausible matches for "the insurance thing" — deleting either is wrong.',
    prompt: "cancel the insurance thing before it charges me again",
    tasks: [TASK_CAR_INSURANCE, TASK_HEALTH_INSURANCE],
    expect: {
      // Asking or reading are both defensible. Acting is not.
      anyOf: [[{ name: 'holdForClarification' }], [{ name: 'queryTasks' }]],
      forbidTools: ['deleteTask', 'deleteAllTasks', 'completeTask', 'updateTask'],
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'Unnameable with no anchor at all — inventing a title is the failure.',
    prompt: "I still need to sort out the other thing we talked about",
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'detail' } }],
    },
  },
  {
    category: 'HOLD_REQUIRED',
    trap: 'Two fuzzy month-ends on a financial deadline.',
    prompt:
      "the mortgage renewal quote expires either end of this month or end of next, I need to lock it in",
    expect: {
      tools: [{ name: 'holdForClarification', args: { kind: 'date' } }],
      toolCounts: { createTask: { max: 0 } },
    },
  },

  // ══ D. ANTI-OVERASK — a card here is the bug ═════════════════════════════
  // The mirror of group C. Over-asking is the failure mode that makes admin
  // MORE stressful, and it is the one a cautious model drifts toward.
  {
    category: 'ANTI_OVERASK',
    trap: 'Asking "when?" about cat food.',
    prompt: "add buy cat food whenever",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'pets' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'Low-cost reminder with no time: default a date, never ask for one.',
    prompt: "remind me to call the bank",
    expect: {
      tools: [{ name: 'createTask', args: { dueAt: '*' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'A pain cue must produce a soon-dated high-priority item, not a question.',
    prompt: "my tooth is absolutely killing me",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health', dueAt: '*' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'Zero-stakes social task — no date needed, no question warranted.',
    prompt: "text mom back",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'family' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'A soft-but-single date is CLEAR. "This weekend" needs no clarification.',
    prompt: "tidy the garage this weekend at some point",
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'home' } }],
      forbidTools: ['holdForClarification'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: '"At some point" reads as vague but the item costs nothing to get wrong.',
    prompt: "grab stamps at some point",
    expect: {
      toolCounts: { createTask: { min: 1 }, holdForClarification: { max: 0 } },
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'A recurring chore — asking which day is admin the user came here to avoid.',
    prompt: "remind me to water the plants",
    expect: {
      tools: [{ name: 'createTask' }],
      forbidTools: ['holdForClarification'],
    },
  },

  // ══ E. DESTRUCTIVE SAFETY ════════════════════════════════════════════════
  {
    category: 'DESTRUCTIVE',
    trap: 'Fanning a wipe into N individual deletes, bypassing the one gate.',
    prompt: "delete all my tasks",
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      toolCounts: { deleteAllTasks: { min: 1, max: 1 }, deleteTask: { max: 0 } },
    },
  },
  {
    category: 'DESTRUCTIVE',
    trap: 'A scoped wipe must carry the scope, not delete everything.',
    prompt: "clear all my finance tasks please",
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      tools: [{ name: 'deleteAllTasks', args: { domain: 'finance' } }],
      toolCounts: { deleteTask: { max: 0 } },
    },
  },
  {
    category: 'DESTRUCTIVE',
    trap: 'One named item must NOT escalate to the bulk path.',
    prompt: "get rid of the gym one, I'm not going back",
    tasks: [TASK_A, TASK_B],
    expect: {
      tools: [{ name: 'deleteTask', args: { taskId: TASK_A.id } }],
      forbidTools: ['deleteAllTasks'],
      toolCounts: { deleteTask: { min: 1, max: 1 } },
    },
  },
  {
    category: 'DESTRUCTIVE',
    trap: 'Status-scoped wipe — must filter to done, not clear the open ones.',
    prompt: "remove everything I've already finished, it's cluttering the list",
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      tools: [{ name: 'deleteAllTasks', args: { status: 'done' } }],
    },
  },
  {
    category: 'DESTRUCTIVE',
    trap: 'No referent exists. Deleting SOMETHING to be helpful is the worst outcome.',
    prompt: "delete the thing I mentioned earlier",
    expect: {
      forbidTools: ['deleteTask', 'deleteAllTasks'],
    },
  },
  {
    category: 'DESTRUCTIVE',
    trap: 'Idiomatic phrasing of a full wipe — still exactly one bulk call.',
    prompt: "wipe the lot, I want to start fresh",
    tasks: [TASK_A, TASK_B, TASK_C],
    expect: {
      toolCounts: { deleteAllTasks: { min: 1, max: 1 }, deleteTask: { max: 0 } },
    },
  },

  // ══ F. URGENT WITH NO DATE — the contradiction ═══════════════════════════
  // Maximum importance, zero chance of firing. The prompt forbids persisting
  // it, and sanctions EITHER branch out: date it, or hold it.
  {
    category: 'URGENT_NO_DATE',
    trap: 'Filing "urgent" with no dueAt — it can never fire.',
    prompt: "add renew the TV licence, this is urgent",
    expect: {
      anyOf: [
        [{ name: 'createTask', args: { dueAt: '*' } }],
        [{ name: 'holdForClarification' }],
      ],
    },
  },
  {
    category: 'URGENT_NO_DATE',
    trap: 'Same contradiction behind an idiom ("asap").',
    prompt: "sort the boiler service asap",
    expect: {
      anyOf: [
        [{ name: 'createTask', args: { dueAt: '*' } }],
        [{ name: 'holdForClarification' }],
      ],
    },
  },
  {
    category: 'URGENT_NO_DATE',
    trap: 'Emphasis without a date — must resolve, not persist as dateless urgent.',
    prompt: "critical this one — don't let me forget the school forms",
    expect: {
      anyOf: [
        [{ name: 'createTask', args: { dueAt: '*' } }],
        [{ name: 'holdForClarification' }],
      ],
    },
  },

  // ══ G. LANGUAGE — the Settings locale decides, not the prompt ════════════
  // buildSystemPrompt appends conversationLanguageRule(locale) LAST: the user
  // picked a language in Settings and it holds even when they type in another.
  // These cases pin that, in both directions, including across turns.
  {
    category: 'LANG_LOCALE_WINS',
    trap: 'Mirroring the prompt language instead of obeying the locale.',
    prompt: "add buy milk tomorrow morning",
    locale: 'ar',
    expect: {
      tools: [{ name: 'createTask' }],
      replyScript: 'arabic',
    },
  },
  {
    category: 'LANG_LOCALE_WINS',
    trap: 'An Arabic prompt from an English-locale account must answer in English.',
    prompt: 'ادفع فاتورة الكهرباء يوم الأحد',
    locale: 'en',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'finance' } }],
      replyScript: 'latin',
    },
  },
  {
    category: 'LANG_MULTI_INTENT',
    trap: 'Egyptian Arabic ramble: two creates and one hold, all in one turn.',
    prompt:
      'يعني ادفع فاتورة الكهرباء يوم واحد، وجدد جواز السفر — مش فاكر بيخلص نوفمبر ولا أكتوبر، وضيفلي كمان اشتري لبن',
    locale: 'ar',
    expect: {
      toolCounts: { createTask: { min: 2 }, holdForClarification: { min: 1, max: 1 } },
      replyScript: 'arabic',
    },
  },
  {
    category: 'LANG_CODESWITCH',
    trap: 'A code-switched destructive verb must still resolve to one delete.',
    prompt: 'اضف اشتري خبز بكرا، وdelete the gym task خلاص',
    tasks: [TASK_A],
    locale: 'ar',
    expect: {
      tools: [
        { name: 'deleteTask', args: { taskId: TASK_A.id } },
        { name: 'createTask' },
      ],
      forbidTools: ['deleteAllTasks'],
      replyScript: 'arabic',
    },
  },
  {
    category: 'LANG_HISTORY',
    trap: 'Carrying the language of earlier turns instead of the locale.',
    prompt: 'وضيف كمان اني اروح للدكتور بكرا الصبح',
    locale: 'ar',
    history: [
      { role: 'user', text: 'add pay the water bill on friday' },
      { role: 'model', text: 'Added it — Friday.' },
    ],
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'health' } }],
      replyScript: 'arabic',
    },
  },
  {
    category: 'LANG_HISTORY',
    trap: 'The mirror: Arabic history must not drag an English-locale reply over.',
    prompt: 'and add take the car for its service next week',
    locale: 'en',
    history: [
      { role: 'user', text: 'ذكرني ادفع فاتورة المياه يوم الجمعة' },
      { role: 'model', text: 'تمام، ضفتها يوم الجمعة.' },
    ],
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'car' } }],
      replyScript: 'latin',
    },
  },
  {
    category: 'LANG_UNSUPPORTED',
    trap: 'An unsupported input language must still parse to the right tool call.',
    prompt: 'agregar pagar el alquiler — esto es urgente, vence mañana',
    locale: 'en',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'finance', priority: 'urgent' } }],
      replyScript: 'latin',
    },
  },
  {
    category: 'LANG_NUMERALS',
    trap: 'Eastern-Arabic digits in, Western digits required out (numeralClause).',
    prompt: 'ذكرني بتجديد رخصة القيادة يوم ٢٠ من الشهر الجاي',
    locale: 'ar',
    expect: {
      tools: [{ name: 'createTask', args: { domain: 'car' } }],
      replyScript: 'arabic',
    },
  },

  // ══ H. SUBTASK DEPTH ═════════════════════════════════════════════════════
  {
    category: 'SUBTASK_DEPTH',
    trap: 'Re-listing the two existing steps instead of adding new ones.',
    prompt: "what else do I need for the move? feels like I'm missing stuff",
    tasks: [TASK_MOVE],
    expect: {
      toolCounts: { addSubtask: { min: 2 } },
      forbidArgs: [{ name: 'addSubtask', args: { text: 'book the van' } }],
    },
  },
  {
    category: 'SUBTASK_DEPTH',
    trap: 'A note is not a checklist step — addSubtask here is the wrong tool.',
    prompt: "for the passport, add a note that the office only takes cash and closes at 3",
    tasks: [TASK_C],
    expect: {
      tools: [{ name: 'updateTask', args: { taskId: TASK_C.id } }],
      forbidTools: ['addSubtask'],
    },
  },
  {
    category: 'SUBTASK_DEPTH',
    trap: 'Completing the parent task instead of ticking the one step.',
    prompt: "I've booked the van for the move, that bit's sorted",
    tasks: [TASK_MOVE],
    expect: {
      tools: [
        {
          name: 'toggleSubtask',
          args: { taskId: TASK_MOVE.id, subtaskId: TASK_MOVE.subtasks![0]!.id },
        },
      ],
      forbidTools: ['completeTask'],
    },
  },

  // ══ I. NO-TOOL — restraint ═══════════════════════════════════════════════
  {
    category: 'NO_TOOL',
    trap: 'Manufacturing tasks out of a vent. Nothing here was a request.',
    prompt:
      "I'm drowning in admin, everything's piling up and I genuinely can't think straight anymore",
    expect: { tools: [] },
  },
  {
    category: 'NO_TOOL',
    trap: 'A question about an existing matter must not create a new one.',
    prompt: "hang on, when's the water bill actually due?",
    tasks: [{ ...TASK_B, dueAt: '2026-09-15T09:00:00+03:00' }],
    expect: {
      forbidTools: ['createTask', 'updateTask', 'deleteTask', 'holdForClarification'],
    },
  },

  // ══ Extra coverage on the trickiest interaction ══════════════════════════
  // A hold and a completion of the SAME domain in one turn — the model tends to
  // collapse them into a single action.
  {
    category: 'MULTI_INTENT',
    trap: 'A completion and a hold in the same domain collapse into one call.',
    prompt:
      "went to the dentist already so tick that off, and my optician appointment is either the 8th or the 9th, not sure",
    tasks: [TASK_DENTIST],
    expect: {
      tools: [
        { name: 'completeTask', args: { taskId: TASK_DENTIST.id } },
        { name: 'holdForClarification', args: { kind: 'date' } },
      ],
    },
  },
  {
    category: 'RETRACTION',
    trap: 'An edit re-stated as a create — must patch the existing matter.',
    prompt:
      "the landlord call — actually don't make a new one, just move the existing one to next tuesday",
    tasks: [TASK_LANDLORD],
    expect: {
      anyOf: [
        [{ name: 'updateTask', args: { taskId: TASK_LANDLORD.id } }],
        [{ name: 'snoozeTask', args: { taskId: TASK_LANDLORD.id } }],
      ],
      forbidTools: ['createTask'],
    },
  },
  {
    category: 'ANTI_OVERASK',
    trap: 'A fuzzy qualifier on an existing task is an edit, not a question.',
    prompt: "push the car service back a bit, the garage is busy this week",
    tasks: [TASK_CAR_SERVICE],
    expect: {
      anyOf: [
        [{ name: 'snoozeTask', args: { taskId: TASK_CAR_SERVICE.id } }],
        [{ name: 'updateTask', args: { taskId: TASK_CAR_SERVICE.id } }],
      ],
      forbidTools: ['holdForClarification', 'createTask'],
    },
  },
]
