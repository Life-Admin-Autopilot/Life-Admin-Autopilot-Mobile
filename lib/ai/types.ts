// AI chat types — mirror the server's wire shapes (server/src/modules/ai).
// Ported from v1 (lib/api/ai.ts) verbatim; pure types, no runtime.

// Keep in lockstep with the server's TOOL_NAMES (server toolRunner.ts). A drift
// here means a real tool_call event arrives with a `name` the client type
// doesn't admit — TOOL_LABEL lookups miss and the chip renders raw.
export type AiToolName =
  | 'createTask'
  | 'updateTask'
  | 'completeTask'
  | 'deleteTask'
  | 'deleteAllTasks'
  | 'snoozeTask'
  | 'queryTasks'
  | 'addSubtask'
  | 'toggleSubtask'
  | 'removeSubtask'
  | 'holdForClarification'

export type AiToolCallStatus = 'pending_confirmation' | 'executed' | 'failed' | 'declined'

export interface AiSource {
  kind: 'task' | 'voice'
  id: string
  title: string
}

export interface AiToolCall {
  callId: string
  name: AiToolName
  args: Record<string, unknown>
  status: AiToolCallStatus
  result?: Record<string, unknown> | null
  error?: string | null
}

export interface AiMessage {
  role: 'user' | 'assistant'
  text: string
  sources: AiSource[]
  toolCalls: AiToolCall[]
  createdAt: string
}

export interface AiConversation {
  scope: 'personal'
  scopeId: string | null
  messages: AiMessage[]
}

export interface AiQuotaRow {
  kind: 'message'
  limit: number
  used: number
  remaining: number
  resetAt: string
}

// SSE event union — mirrors AskEvent on the server (modules/ai/routes.ts).
export type AskEvent =
  | { type: 'sources'; sources: AiSource[] }
  | { type: 'token'; text: string }
  | {
      type: 'tool_call'
      callId: string
      name: AiToolName
      args: Record<string, unknown>
      needsConfirmation: boolean
    }
  | {
      type: 'tool_result'
      callId: string
      result: Record<string, unknown> | null
      error: string | null
    }
  | { type: 'done'; usage: Record<string, number | undefined> }
  | {
      type: 'quota'
      tier: 'free' | 'pro'
      quotas: AiQuotaRow[]
    }
  | { type: 'error'; code: string; message: string }
