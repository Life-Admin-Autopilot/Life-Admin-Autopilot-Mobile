import {
  FunctionCallingConfigMode,
  type Tool,
  Type,
} from '@google/genai'

import { env } from '../../env'
import { AppError } from '../../lib/errors'
import { formatNow } from './contextBuilder'
import { getGeminiClient } from './provider/geminiClient'
import type { Domain } from '../../models/User'
import type { TaskPriority } from '../../models/Task'

// Custom-answer path for a held clarification. When the user TYPES their own
// answer (rather than picking a pre-resolved option), we can't deterministically
// patch the draft — the answer might be a date phrase, a who/what, or both. So
// we do ONE bounded Gemini call that folds the held item + the typed answer into
// a single createTask call. The route then runs those args through the SAME
// toolRunner.createTask path (re-validating + normalizing the date), so a custom
// answer creates an identical Task to what the chat agent would have.

// A focused createTask declaration — intentionally a small, local copy of the
// chat tool's core fields (not the full chat surface). Drift risk is low: this
// only ever produces a task from an already-scoped draft.
const CREATE_TASK_TOOL: Tool[] = [
  {
    functionDeclarations: [
      {
        name: 'createTask',
        description: 'Create the held task now that the user has answered the question.',
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Short title in the user's language (≤240 chars)." },
            domain: {
              type: Type.STRING,
              enum: ['health', 'home', 'car', 'finance', 'family', 'pets'],
            },
            priority: { type: Type.STRING, enum: ['low', 'normal', 'high', 'urgent'] },
            dueAt: {
              type: Type.STRING,
              description:
                "ISO 8601 with literal 'T' and explicit offset (use the offset from NOW). Omit if the answer gives no date.",
            },
            notes: { type: Type.STRING, description: 'Optional notes (≤2000 chars).' },
          },
          required: ['title', 'domain', 'priority'],
        },
      },
    ],
  },
]

const RESOLVE_TEMPERATURE = 0

function isThinkingCapableModel(modelId: string): boolean {
  return /gemini-2\.5/.test(modelId)
}

export interface ResolveAnswerInput {
  draft: {
    title: string
    domain: Domain
    priority: TaskPriority
    notes?: string
    dueAt?: string
  }
  question: string
  customText: string
  timezone?: string
}

function buildPrompt(input: ResolveAnswerInput): string {
  const anchor = formatNow(input.timezone)
  const dueGuess = input.draft.dueAt ? `\nCurrent due guess: ${input.draft.dueAt}` : ''
  return [
    'You turn a single held to-do plus the user\'s answer into ONE createTask call.',
    'The user mentioned a task you could not fully pin down, so you asked a question.',
    'They have now answered. Bake the answer in and produce exactly one createTask call.',
    'Keep the title in the user\'s language. Resolve any date in the answer to ISO 8601',
    "with the user's offset (from NOW). If the answer clarifies the who/what, update the",
    'title and/or notes. Never ask anything back — always call createTask.',
    '',
    `NOW (user local time): ${anchor}`,
    `Held task: "${input.draft.title}" — domain ${input.draft.domain}, priority ${input.draft.priority}${dueGuess}`,
    `Question you asked: "${input.question}"`,
    `User's answer: "${input.customText}"`,
  ].join('\n')
}

// Returns the raw createTask args object (unvalidated) for the route to run
// through toolRunner. Throws when the model fails to produce a function call so
// the route can keep the clarification OPEN and never lose the held item.
export async function interpretCustomAnswer(
  input: ResolveAnswerInput,
): Promise<Record<string, unknown>> {
  const client = getGeminiClient()
  const modelId = env().GEMINI_MODEL
  const res = await client.models.generateContent({
    model: modelId,
    contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
    config: {
      tools: CREATE_TASK_TOOL,
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['createTask'],
        },
      },
      temperature: RESOLVE_TEMPERATURE,
      ...(isThinkingCapableModel(modelId)
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  })

  const parts = res.candidates?.[0]?.content?.parts ?? []
  for (const part of parts) {
    if (part.functionCall && part.functionCall.name === 'createTask') {
      return (part.functionCall.args ?? {}) as Record<string, unknown>
    }
  }
  throw new AppError(
    502,
    'clarification_unresolved',
    'Could not turn that answer into a task. Try rephrasing it.',
  )
}
