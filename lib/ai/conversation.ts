// Non-streaming AI endpoints — thread list/CRUD, one thread's transcript, and
// quota. These go through the standard JSON api() (the streaming turns live in
// stream.ts).

import { api } from '@/lib/api/client'
import type { AiQuotaRow, AiThread, AiThreadSummary } from '@/lib/ai/types'

export async function fetchThreads(): Promise<AiThreadSummary[]> {
  const res = await api<{ conversations: AiThreadSummary[] }>('/ai/conversations')
  return res.conversations
}

export async function fetchThread(conversationId: string): Promise<AiThread> {
  return api<AiThread>(`/ai/conversations/${encodeURIComponent(conversationId)}`)
}

export async function createThread(title?: string): Promise<AiThreadSummary> {
  return api<AiThreadSummary>('/ai/conversations', {
    method: 'POST',
    body: title ? { title } : {},
  })
}

export async function renameThread(
  conversationId: string,
  title: string,
): Promise<{ id: string; title: string }> {
  return api<{ id: string; title: string }>(
    `/ai/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'PATCH', body: { title } },
  )
}

export async function deleteThread(conversationId: string): Promise<void> {
  await api<void>(`/ai/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  })
}

export async function fetchQuota(): Promise<{ tier: 'free' | 'pro'; quotas: AiQuotaRow[] }> {
  return api<{ tier: 'free' | 'pro'; quotas: AiQuotaRow[] }>('/ai/quota')
}
