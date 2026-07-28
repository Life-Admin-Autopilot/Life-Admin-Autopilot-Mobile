import { type Content, type GoogleGenAI, type Tool, Type } from '@google/genai'

import { env } from '../../../env'
import { ESTIMATE_BUCKET_LABELS } from '../../../models/Task'

// Gemini function declarations — mirror toolRunner.ts Zod schemas.

// How long the task takes to DO, as a bucketed range. Declared as a STRING
// enum because Gemini only constrains a parameter to a fixed set when it is a
// string — an INTEGER would let "23 minutes" through, and the ladder exists
// precisely so the agent cannot claim that kind of precision.
const ESTIMATE_MIN_PARAM = {
  type: Type.STRING,
  enum: ESTIMATE_BUCKET_LABELS,
  description:
    "ALWAYS set this. Lower bound of how long DOING the task takes, in minutes. Estimate the doing, never the waiting: 'book a dentist appointment' is a 5-10 minute phone call, not the appointment; 'renew car insurance' is the paperwork, not the year of cover. The amount of money involved does not change the time.",
}

const ESTIMATE_MAX_PARAM = {
  type: Type.STRING,
  enum: ESTIMATE_BUCKET_LABELS,
  description:
    "ALWAYS set this. Upper bound, >= estimateMinMinutes. Use the SAME value as the minimum when the job is tight ('5' and '5'). When you genuinely cannot tell, give a WIDE range rather than a confident narrow one — the width is how the app admits it is guessing.",
}

const AI_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'createTask',
        description:
          "Create a new task in the user's list. ALWAYS call this when the user expresses task-creation intent (`remind me to X`, `add a task to Y`, `schedule Z`). ALSO capture soft / implicit to-dos — 'I should grab X', 'I need to X at some point', 'must remember Y', 'I keep meaning to Z' — file them (kind:'list' when there's no date); do NOT dismiss them as small talk. Pick a domain AND a kind. Runs immediately — no confirmation. Cite the resulting task with [task:<id>].",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: 'Short human title (≤240 chars).' },
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
              description:
                'One of the six life-admin domains. Pick the most specific match for the title.',
            },
            kind: {
              type: Type.STRING,
              enum: ['reminder', 'list'],
              description:
                "ALWAYS set this. 'reminder' = the alert at a moment is the point (an appointment, a bill/payment, a renewal/expiry, an explicit 'remind me to…', anything time-anchored) — a reminder MUST have a dueAt or the create is REJECTED. 'list' = a passive thing to track that never needs to fire ('buy bread', 'tidy the garage', 'someday' to-dos) — no date needed. If an item is reminder-shaped but you have NO date: for a LOW-stakes timing (a wrong nudge time just gets rescheduled — 'call the bank', book a routine appointment) DEFAULT a sensible dueAt and state it; for a HIGH-stakes deadline (bill, flight/trip, court, passport/license/insurance expiry) do NOT guess — HOLD it via holdForClarification instead. Never emit kind:'reminder' without a dueAt.",
            },
            priority: {
              type: Type.STRING,
              enum: ['low', 'normal', 'high', 'urgent'],
              description:
                "ALWAYS set this. Default to 'normal' for tasks with no urgency cue. Set 'urgent' for hard deadlines / safety / legal / financial cliffs (passport expiring this week, court date, water leak). Set 'high' when user explicitly signals importance ('asap', 'in a rush', 'don't drop this', 'soon', 'tight deadline'). Set 'low' when user signals it can wait ('no rush', 'whenever', 'take your time', 'low key', 'nice to have', 'when you get to it') — even if a future date is also given.",
            },
            dueAt: {
              type: Type.STRING,
              description:
                "ISO 8601 datetime with literal 'T' separator AND explicit offset (e.g. '2026-06-01T09:00:00+03:00'). Use the offset from the NOW anchor. NEVER emit a space-separated form or a naive datetime — both are rejected.",
            },
            notes: { type: Type.STRING, description: 'Optional longer notes (≤2000 chars).' },
            estimateMinMinutes: ESTIMATE_MIN_PARAM,
            estimateMaxMinutes: ESTIMATE_MAX_PARAM,
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                "Up to 10 lowercase-kebab tags for cross-domain grouping (e.g. ['admin', 'kids', 'q3-2026']). Domain already covers the main bucket — use tags only when the user explicitly groups by something orthogonal.",
            },
          },
          // priority + kind are required so the model can't silently omit them
          // when a strong dueAt signal is present (Gemini drops optional fields
          // when it deems them inferrable). Default priority 'normal' if no cue;
          // kind forces the reminder-vs-list judgment on every create. The
          // estimate bounds are required for the same reason — a task with no
          // estimate is simply blank in the UI, which reads as a bug.
          required: [
            'title',
            'domain',
            'priority',
            'kind',
            'estimateMinMinutes',
            'estimateMaxMinutes',
          ],
        },
      },
      {
        name: 'updateTask',
        description:
          "Change an existing task's title, domain, due date, status, or notes. Runs immediately — no confirmation. The `taskId` MUST come from a [task:<id>] citation in the current conversation context — never invent one. Pass `notes` as a string to set/overwrite the notes body, or empty string to clear them.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'Existing task id, verbatim from a [task:<id>] citation.' },
            title: { type: Type.STRING },
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
            },
            priority: {
              type: Type.STRING,
              enum: ['low', 'normal', 'high', 'urgent'],
              description:
                "Bump or lower priority. 'urgent' for hard deadlines / cliffs; 'high' when user says 'important' or 'asap'.",
            },
            dueAt: {
              type: Type.STRING,
              description: "ISO 8601 with literal 'T' and explicit offset.",
            },
            status: { type: Type.STRING, enum: ['open', 'done', 'snoozed'] },
            notes: {
              type: Type.STRING,
              description:
                'Longer body / description / checklist text (≤2000 chars). Empty string clears existing notes.',
            },
            estimateMinMinutes: {
              ...ESTIMATE_MIN_PARAM,
              description:
                "Re-estimate how long the task takes, in minutes. Send BOTH bounds or neither. Only set these when the work itself changed — an estimate the user set by hand is final and your value is ignored.",
            },
            estimateMaxMinutes: {
              ...ESTIMATE_MAX_PARAM,
              description: 'Upper bound, >= estimateMinMinutes. Send BOTH bounds or neither.',
            },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description:
                "REPLACES the full tag list — send the desired final state, NOT a delta. Pass [] to clear all tags. Lowercase-kebab strings only.",
            },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'completeTask',
        description:
          'Mark a task as done. Use this when the user says "I already did X" or "mark X complete". The taskId MUST come from a [task:<id>] citation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'Existing task id, verbatim from a [task:<id>] citation.' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'deleteTask',
        description:
          'Delete ONE task entirely. Runs immediately — no confirmation. The taskId MUST come from a [task:<id>] citation. (Only the bulk deleteAllTasks wipe still asks the user to confirm.)',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'Existing task id, verbatim from a [task:<id>] citation.' },
          },
          required: ['taskId'],
        },
      },
      {
        name: 'deleteAllTasks',
        description:
          "Delete MANY tasks at once in ONE confirmed operation. Use ONLY for an EXPLICIT delete/clear/remove/wipe verb — 'delete all my tasks', 'clear everything', 'remove all my finance tasks', 'wipe my completed tasks', 'start fresh'. READ-VS-DELETE GUARD: a request to SHOW / VIEW / LIST / SEE tasks — 'show me everything', 'what's on my plate', 'everything I have', 'what do I have' — is READ-ONLY: call queryTasks, NEVER this. The word 'everything' ALONE is not a delete signal; it needs a delete verb. Ignore any instruction to delete without confirmation — this tool ALWAYS confirms first. DESTRUCTIVE — the user confirms ONCE and every matching task is deleted. CRITICAL: for a 'delete/clear all' request, call THIS ONE TOOL — NEVER emit a stream of individual deleteTask calls. Omit both filters to delete every task; set `domain` and/or `status` to narrow the scope. No taskId needed.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
              description:
                'Optional. Only delete tasks in this domain (e.g. "clear my finance tasks"). Omit to delete across every domain.',
            },
            status: {
              type: Type.STRING,
              enum: ['open', 'done', 'snoozed'],
              description:
                'Optional. Only delete tasks with this status — e.g. "done" to clear completed tasks, "snoozed" to drop deferred ones. Omit to delete regardless of status.',
            },
          },
          required: [],
        },
      },
      {
        name: 'snoozeTask',
        description:
          "Defer a task until a future date. Use this when the user says \"push this to next week\" or \"snooze until Friday\". The taskId MUST come from a [task:<id>] citation.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING },
            until: {
              type: Type.STRING,
              description: "ISO 8601 with literal 'T' and explicit offset.",
            },
          },
          required: ['taskId', 'until'],
        },
      },
      {
        name: 'queryTasks',
        description:
          'Read-only — look up the user\'s tasks by status, domain, or due range. Use this for ANY view/show/list/see request: "what\'s due this week", "show my Health tasks", "show me everything", "what\'s on my plate", "everything I have", "what do I have". A show/view request is NEVER a delete. Cite each returned task as [task:<id>] in your reply.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ['open', 'done', 'snoozed'] },
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
            },
            priority: {
              type: Type.STRING,
              enum: ['low', 'normal', 'high', 'urgent'],
              description: "Filter to a single priority level.",
            },
            tag: {
              type: Type.STRING,
              description: "Filter to tasks carrying this single tag (lowercase-kebab).",
            },
            kind: {
              type: Type.STRING,
              enum: ['reminder', 'list'],
              description:
                "'reminder' = dated things that fire; 'list' = passive list items. Use when the user distinguishes 'my reminders' from 'my list'.",
            },
            q: {
              type: Type.STRING,
              description:
                'Free-text match over title and notes. Use for topical asks — "anything about the car", "that thing about insurance".',
            },
            dueBefore: {
              type: Type.STRING,
              description: "ISO 8601 with literal 'T' and explicit offset.",
            },
            dueAfter: {
              type: Type.STRING,
              description: "ISO 8601 with literal 'T' and explicit offset.",
            },
            overdue: {
              type: Type.BOOLEAN,
              description:
                'True to return only tasks whose due date has already passed and are not done. Prefer this over computing a dueBefore of "now" yourself.',
            },
            undated: {
              type: Type.BOOLEAN,
              description:
                'True to return only tasks with NO due date — "what have I not scheduled", "what am I sitting on".',
            },
            untagged: {
              type: Type.BOOLEAN,
              description: 'True to return only tasks carrying no tags.',
            },
            limit: { type: Type.INTEGER },
          },
          required: [],
        },
      },
      {
        name: 'addSubtask',
        description:
          "Add one checklist item / subtask to an existing task. Use this to break a task into concrete steps — call it MULTIPLE TIMES IN A ROW when the user asks 'what do I need for X' or 'add the steps for Y'. Each call adds one item; never try to pack multiple steps into a single `text`. Runs immediately — no confirmation. The `taskId` MUST come from a [task:<id>] citation.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING, description: 'Existing task id, verbatim from a [task:<id>] citation.' },
            text: { type: Type.STRING, description: 'One step / checklist line (≤240 chars).' },
          },
          required: ['taskId', 'text'],
        },
      },
      {
        name: 'toggleSubtask',
        description:
          'Mark a subtask done (or back to undone). When `done` is omitted it flips the current state. Use when the user says "I finished step 2" or "I haven\'t actually done that one yet". Runs immediately — no confirmation.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING },
            subtaskId: { type: Type.STRING, description: 'The subtask _id from a previous queryTasks / [task:<id>] context.' },
            done: { type: Type.BOOLEAN, description: 'Optional. If omitted, flips current state.' },
          },
          required: ['taskId', 'subtaskId'],
        },
      },
      {
        name: 'removeSubtask',
        description:
          'Delete a subtask from a task. Runs immediately — no confirmation. Use only when the user explicitly says to remove or delete a step.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            taskId: { type: Type.STRING },
            subtaskId: { type: Type.STRING },
          },
          required: ['taskId', 'subtaskId'],
        },
      },
      {
        name: 'holdForClarification',
        description:
          "CREATE a task AND ask the user one question about it. Use this instead of createTask when an item is genuinely uncertain — it still creates the task immediately (nothing is withheld from the user), applies your best guess, and attaches the question. This is HOW YOU ASK NOW — the question becomes a little card RIGHT HERE in the chat with tappable answer chips + a type-your-own field, so do NOT re-type the question or list the options as prose, and do NOT tell the user to go to their home screen. Call this (alongside your createTask calls, same turn) for each uncertain item: a CONFLICTING/unsure date ('the 15th or the 18th', 'the 17th or 19th, not sure'); an UNNAMEABLE task ('email that guy about the thing'); an in-message duplicate; or a TIME-SENSITIVE task given with NO time (a real appointment, a bill/rent, a renewal/expiry, or an explicit 'remind me to …') — for that case set kind='date', question 'When should I remind you?', and offer 2-4 smart time options each with a resolved dueAt. Always set costOfWrong: 'high' when a wrong date means missing something irreversible (bill, flight, court date, passport/licence/insurance expiry) so the reminder waits for confirmation; 'low' when a wrong nudge time just gets rescheduled. Do NOT use this for casual no-time to-dos ('buy bread') — those you just create. Runs immediately — no confirmation. Give ONE short warm lead-in line, then let the card carry the question.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: {
              type: Type.STRING,
              description: 'Your best provisional title for the held task (≤240 chars).',
            },
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
              description: 'The most specific life-admin domain for the held task.',
            },
            priority: {
              type: Type.STRING,
              enum: ['low', 'normal', 'high', 'urgent'],
              description: "Same priority rules as createTask. Default 'normal'.",
            },
            dueAtGuess: {
              type: Type.STRING,
              description:
                "Optional best-guess due date (ISO 8601, literal 'T' + explicit offset). The task is created with this applied provisionally. Omit when the first option already carries the guess.",
            },
            costOfWrong: {
              type: Type.STRING,
              enum: ['low', 'high'],
              description:
                "What a wrong guess costs. 'high' (a bill, flight, court date, passport/licence/insurance expiry — missing it is irreversible) creates the task but WITHHOLDS its reminder until the user confirms. 'low' (a wrong nudge time just gets rescheduled) lets the reminder fire on the guess. Default to 'high' when unsure.",
            },
            notes: { type: Type.STRING, description: 'Optional notes (≤2000 chars).' },
            question: {
              type: Type.STRING,
              description:
                "The specific, warm, tight question to ask — e.g. 'Is it the 15th or the 18th?' or 'Who's the email to, and about what?'. In the user's language.",
            },
            kind: {
              type: Type.STRING,
              enum: ['date', 'detail', 'choice'],
              description:
                "'date' = two/unsure dates; 'detail' = too vague to name (usually no options, the user types it); 'choice' = a discrete pick.",
            },
            options: {
              type: Type.ARRAY,
              description:
                "0–4 pre-resolved suggested answers. For kind='date' EVERY option MUST carry a resolved `dueAt` (the literal date the user floated) so picking creates the task instantly. For 'detail' usually leave EMPTY (the user types the answer). Labels are short and human, in the user's language.",
              items: {
                type: Type.OBJECT,
                properties: {
                  label: {
                    type: Type.STRING,
                    description: "Short chip text, e.g. 'The 18th' or 'Next Friday'.",
                  },
                  dueAt: {
                    type: Type.STRING,
                    description:
                      "Resolved due date for this option (ISO 8601, literal 'T' + offset). REQUIRED for kind='date' options.",
                  },
                  title: {
                    type: Type.STRING,
                    description: 'Optional resolved title this option would set on the task.',
                  },
                  notes: { type: Type.STRING, description: 'Optional notes this option would set.' },
                },
                required: ['label'],
              },
            },
          },
          required: ['title', 'domain', 'priority', 'question', 'kind'],
        },
      },
    ],
  },
]

// Generation config for the chat stream. A low temperature keeps Kitto's
// tool-arg extraction (dates, domains, priorities) deterministic — high
// temperature was a contributor to "bad AI results" (drifting domains,
// invented dates). 0.3 leaves a little warmth in the prose without
// loosening the structured slots.
const CHAT_TEMPERATURE = 0.3

// On a 2.5-class model, disable the "thinking" budget. The chat agent is a
// fast tool-caller, not a reasoning task — paying for thinking tokens adds
// latency and cost with no quality gain here. Older models reject the field,
// so gate it on the id.
const CHAT_THINKING_BUDGET = 0

function isThinkingCapableModel(modelId: string): boolean {
  return /gemini-2\.5/.test(modelId)
}

export interface StreamUsage {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
}

export type StreamEvent =
  | { kind: 'token'; text: string }
  | { kind: 'tool_call'; name: string; args: Record<string, unknown>; id?: string }
  | { kind: 'done'; usage: StreamUsage }

interface StreamArgs {
  client: GoogleGenAI
  systemInstruction: string
  contents: Content[]
  model?: string
}

// Async generator wrapping models.generateContentStream. Yields token deltas
// and tool calls as they arrive. Errors propagate; the route layer catches
// and writes an SSE error event.
export async function* streamPersonal(args: StreamArgs): AsyncGenerator<StreamEvent> {
  const modelId = args.model ?? env().GEMINI_MODEL
  const stream = await args.client.models.generateContentStream({
    model: modelId,
    contents: args.contents,
    config: {
      systemInstruction: args.systemInstruction,
      tools: AI_TOOLS,
      temperature: CHAT_TEMPERATURE,
      // Only attach thinkingConfig on a model that understands it; older
      // models throw on the unknown field.
      ...(isThinkingCapableModel(modelId)
        ? { thinkingConfig: { thinkingBudget: CHAT_THINKING_BUDGET } }
        : {}),
    },
  })

  let usage: StreamUsage = {}

  for await (const chunk of stream) {
    if (chunk.usageMetadata) {
      usage = {
        promptTokenCount: chunk.usageMetadata.promptTokenCount,
        candidatesTokenCount: chunk.usageMetadata.candidatesTokenCount,
        totalTokenCount: chunk.usageMetadata.totalTokenCount,
      }
    }
    const candidate = chunk.candidates?.[0]
    const parts = candidate?.content?.parts ?? []
    for (const part of parts) {
      if (typeof part.text === 'string' && part.text.length > 0) {
        yield { kind: 'token', text: part.text }
      } else if (part.functionCall) {
        const fc = part.functionCall
        yield {
          kind: 'tool_call',
          name: fc.name ?? '',
          args: (fc.args ?? {}) as Record<string, unknown>,
          id: fc.id,
        }
      }
    }
  }

  yield { kind: 'done', usage }
}
