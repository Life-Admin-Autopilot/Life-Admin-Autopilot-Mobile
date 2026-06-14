// Non-streaming AI endpoints — conversation history, reset, and quota. These go
// through the standard JSON api() (the streaming turns live in stream.ts).

import { api } from '@/lib/api/client'
import type { AiConversation, AiQuotaRow } from '@/lib/ai/types'

export async function fetchConversation(): Promise<AiConversation> {
  return api<AiConversation>('/ai/conversation')
}

export async function resetConversation(): Promise<AiConversation> {
  return api<AiConversation>('/ai/conversation/reset', { method: 'POST' })
}

export async function fetchQuota(): Promise<{ tier: 'free' | 'pro'; quotas: AiQuotaRow[] }> {
  return api<{ tier: 'free' | 'pro'; quotas: AiQuotaRow[] }>('/ai/quota')
}
