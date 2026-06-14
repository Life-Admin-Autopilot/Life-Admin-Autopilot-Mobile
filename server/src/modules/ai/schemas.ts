import { z } from 'zod'

// Request body for POST /ai/ask. `scope` is forward-looking — v1 only
// implements `personal`. Mirrors Wiscord's schema shape so the future
// channel / server scopes don't need a request-shape migration.

export const AI_SCOPES = ['personal'] as const
export type AiScope = (typeof AI_SCOPES)[number]

export const askBodySchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'question cannot be empty')
    .max(2000, 'question cannot exceed 2000 characters'),
  scope: z.enum(AI_SCOPES).default('personal'),
  // IANA timezone of the caller (e.g. 'Africa/Cairo'). Anchors relative-time
  // phrases ("tomorrow 9am") to the user's local clock instead of UTC.
  // Optional — falls back to UTC if absent.
  timezone: z.string().min(1).max(64).optional(),
})

export type AskBody = z.infer<typeof askBodySchema>

// Body for POST /ai/tools/confirm/:callId — destructive tool confirmation.
export const confirmToolBodySchema = z.object({
  action: z.enum(['confirm', 'decline']),
})

export type ConfirmToolBody = z.infer<typeof confirmToolBodySchema>
