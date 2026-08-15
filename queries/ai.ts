// AI chat server state — thread list, one thread's transcript, quota, and the
// thread lifecycle mutations behind the history drawer.
//
// The streaming state machine (useAskAi) lives in queries/aiChat.ts; this file
// is the plain server-state layer it reads from.

'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  createThread,
  deleteThread,
  fetchQuota,
  fetchThread,
  fetchThreads,
  renameThread,
} from '@/lib/ai/conversation'
import { useActiveThreadStore } from '@/lib/ai/activeThreadStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { queryKeys } from '@/queries/keys'
import type { AiThreadSummary } from '@/lib/ai/types'

export function useAiThreads() {
  return useQuery({
    queryKey: queryKeys.ai.threads(),
    queryFn: fetchThreads,
    staleTime: 30_000,
  })
}

/**
 * One thread's transcript.
 *
 * `enabled` is false while the id is null — that state means "no thread chosen
 * yet", which resolves to the most recent one as soon as the list lands. A
 * disabled query is the honest encoding: there is nothing to fetch, as opposed
 * to a fetch that is failing.
 */
export function useAiThread(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.ai.thread(conversationId ?? ''),
    queryFn: () => fetchThread(conversationId as string),
    enabled: conversationId !== null,
    staleTime: 60_000,
  })
}

export function useAiQuota() {
  return useQuery({
    queryKey: queryKeys.ai.quota(),
    queryFn: fetchQuota,
    staleTime: 30_000,
  })
}

/**
 * Which thread to show.
 *
 * The store holds the user's explicit choice; until they make one, the most
 * recently active thread wins — so reopening the island lands where they left
 * off without persisting anything.
 */
export function useResolvedThreadId(): string | null {
  const chosen = useActiveThreadStore((s) => s.activeId)
  const threads = useAiThreads()
  if (chosen) return chosen
  return threads.data?.[0]?.id ?? null
}

export function useCreateThread() {
  const qc = useQueryClient()
  const setActiveId = useActiveThreadStore((s) => s.setActiveId)

  return useMutation({
    mutationFn: () => createThread(),
    onSuccess: (thread: AiThreadSummary) => {
      // Seed the list so the new thread is on screen before the refetch lands.
      qc.setQueryData<AiThreadSummary[]>(queryKeys.ai.threads(), (prev) =>
        prev ? [thread, ...prev] : [thread],
      )
      setActiveId(thread.id)
      void qc.invalidateQueries({ queryKey: queryKeys.ai.threads() })
    },
    onError: (err: unknown) => toast.error(translateBackendError(err)),
  })
}

export function useRenameThread() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameThread(id, title),
    onSuccess: ({ id, title }) => {
      qc.setQueryData<AiThreadSummary[]>(queryKeys.ai.threads(), (prev) =>
        prev?.map((t) => (t.id === id ? { ...t, title } : t)),
      )
    },
    onError: (err: unknown) => toast.error(translateBackendError(err)),
  })
}

export function useDeleteThread() {
  const qc = useQueryClient()
  const activeId = useActiveThreadStore((s) => s.activeId)
  const setActiveId = useActiveThreadStore((s) => s.setActiveId)

  return useMutation({
    mutationFn: (id: string) => deleteThread(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<AiThreadSummary[]>(queryKeys.ai.threads(), (prev) =>
        prev?.filter((t) => t.id !== id),
      )
      qc.removeQueries({ queryKey: queryKeys.ai.thread(id) })
      // Deleting the thread on screen drops the selection rather than picking a
      // neighbour: null resolves to the most recent survivor, which is the same
      // rule that chose this one, instead of a second rule that could disagree.
      if (activeId === id) setActiveId(null)
      void qc.invalidateQueries({ queryKey: queryKeys.ai.threads() })
    },
    onError: (err: unknown) => toast.error(translateBackendError(err)),
  })
}
