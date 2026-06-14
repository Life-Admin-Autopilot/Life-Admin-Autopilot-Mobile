// AI chat surface — TanStack Query hooks + the streaming state machine.
//
// `useAiConversation` / `useAiQuota` are pure server-state queries. `useAskAi`
// is the streaming state machine: optimistic user bubble, accumulating assistant
// draft, tool-call confirmation, retry, and clear. It owns a ref-tracked
// AbortController so a fresh ask()/confirm() aborts any in-flight stream.
//
// Ported from v1 (hooks/useAskAi.ts), minus the task/clarification cache
// patching — V2 has no tasks query yet (the dashboard matters are static). When
// a /tasks query lands, re-introduce an applyToolResult patch + invalidation at
// the marked seams.

'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { askStream, confirmStream } from '@/lib/ai/stream'
import { fetchConversation, fetchQuota, resetConversation } from '@/lib/ai/conversation'
import { ApiError } from '@/lib/api/client'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { queryKeys } from '@/queries/keys'
import type { AiMessage, AiQuotaRow, AiToolCall } from '@/lib/ai/types'

export function useAiConversation() {
  return useQuery({
    queryKey: queryKeys.ai.conversation(),
    queryFn: fetchConversation,
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

export type AiStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface UseAskAiResult {
  status: AiStatus
  messages: AiMessage[]
  /** Current in-flight assistant draft (tokens accumulating). */
  pending: AiMessage | null
  isLoadingConversation: boolean
  conversationError: unknown
  refetchConversation: () => void
  isClearing: boolean
  /** Which tool callId + action the user is currently waiting on. */
  pendingConfirm: { callId: string; action: 'confirm' | 'decline' } | null
  error: string | null
  /** The question whose turn failed mid-stream, so the UI can offer a one-tap
   *  retry instead of forcing the user to retype. */
  failedQuestion: string | null
  quotas: AiQuotaRow[] | null
  ask: (question: string, timezone?: string) => Promise<void>
  /** Re-issue the last failed question (clears the failed-turn state). */
  retry: (timezone?: string) => void
  clear: () => Promise<void>
  confirm: (callId: string, action: 'confirm' | 'decline') => Promise<void>
}

function emptyMessage(role: 'user' | 'assistant'): AiMessage {
  return { role, text: '', sources: [], toolCalls: [], createdAt: new Date().toISOString() }
}

// Drive a chat session — wraps the SSE iterator with React state.
export function useAskAi(): UseAskAiResult {
  const qc = useQueryClient()
  const conv = useAiConversation()

  const [status, setStatus] = useState<AiStatus>('idle')
  const [pending, setPending] = useState<AiMessage | null>(null)
  const [localMessages, setLocalMessages] = useState<AiMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null)
  const [quotas, setQuotas] = useState<AiQuotaRow[] | null>(null)
  const [isClearing, setIsClearing] = useState(false)
  const [pendingConfirm, setPendingConfirm] = useState<
    { callId: string; action: 'confirm' | 'decline' } | null
  >(null)
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous re-entry guard for confirm() — a state-based guard
  // (pendingConfirm) can read stale from a closure captured before the commit
  // lands, letting a fast double-tap slip a second confirm through.
  const confirmInFlightRef = useRef(false)
  // Tracks the size of the optimistic local list right after a finalize so the
  // next server sync can't shrink it back below the just-streamed turn
  // (eventually-consistent reads briefly omit the new assistant message).
  const optimisticFloorRef = useRef(0)

  // Seed the message list from the server snapshot exactly ONCE per mount, then
  // never let a background refetch overwrite it. After the first turn, the local
  // list is authoritative: every turn appends its own user + finalized assistant
  // message, and post-turn invalidations refresh quota without touching the
  // transcript. This avoids the reconcile churn that briefly double-rendered the
  // freshly-streamed bubble (server snapshot replacing the optimistic list). The
  // panel remounts when reopened, so persisted history reloads then.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    if (!conv.data) return
    seededRef.current = true
    setLocalMessages(conv.data.messages)
    optimisticFloorRef.current = conv.data.messages.length
  }, [conv.data])

  // Abort the active stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const ask = useCallback(
    async (question: string, timezone?: string) => {
      // Cancel any in-flight stream before starting a new one.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const trimmed = question.trim()
      if (trimmed.length === 0) return

      setError(null)
      setFailedQuestion(null)
      setStatus('streaming')

      const userMessage: AiMessage = { ...emptyMessage('user'), text: trimmed }
      const draft: AiMessage = emptyMessage('assistant')
      setLocalMessages((prev) => [...prev, userMessage])
      setPending(draft)

      try {
        for await (const event of askStream({ question: trimmed, timezone, signal: controller.signal })) {
          if (event.type === 'sources') {
            const seen = new Set(draft.sources.map((s) => `${s.kind}:${s.id}`))
            const incoming = event.sources.filter((s) => !seen.has(`${s.kind}:${s.id}`))
            draft.sources = [...draft.sources, ...incoming]
            setPending({ ...draft })
          } else if (event.type === 'token') {
            draft.text += event.text
            setPending({ ...draft })
          } else if (event.type === 'tool_call') {
            const toolCall: AiToolCall = {
              callId: event.callId,
              name: event.name,
              args: event.args,
              status: event.needsConfirmation ? 'pending_confirmation' : 'executed',
              result: null,
              error: null,
            }
            draft.toolCalls = [...draft.toolCalls, toolCall]
            setPending({ ...draft })
          } else if (event.type === 'tool_result') {
            draft.toolCalls = draft.toolCalls.map((t) =>
              t.callId === event.callId
                ? { ...t, status: event.error ? 'failed' : 'executed', result: event.result, error: event.error }
                : t,
            )
            setPending({ ...draft })
            // TODO(tasks-query): when a /tasks query exists, patch its cache here
            // from (call.name, event.result, call.args) so matter surfaces update
            // the instant the tool runs.
          } else if (event.type === 'quota') {
            setQuotas(event.quotas)
          } else if (event.type === 'done') {
            setStatus('done')
          } else if (event.type === 'error') {
            setError(event.message)
            setStatus('error')
          }
        }
        // Finalize: drop the in-flight draft and refetch the server conversation
        // so persisted state is authoritative. Raise the optimistic floor so a
        // lagged refetch can't shrink the list back below this streamed turn.
        setLocalMessages((prev) => {
          const next = [...prev, draft]
          optimisticFloorRef.current = next.length
          return next
        })
        setPending(null)
        await qc.invalidateQueries({ queryKey: queryKeys.ai.conversation() })
        await qc.invalidateQueries({ queryKey: queryKeys.ai.quota() })
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        setPending(null)
        // Keep the question so the UI can offer a one-tap retry — the user's
        // bubble stays put in localMessages.
        setFailedQuestion(trimmed)
      }
    },
    [qc],
  )

  const retry = useCallback(
    (timezone?: string) => {
      const question = failedQuestion
      if (!question) return
      setFailedQuestion(null)
      // Drop the orphaned user bubble from the failed turn — ask() re-appends it.
      setLocalMessages((prev) => {
        const last = prev[prev.length - 1]
        const next =
          last && last.role === 'user' && last.text === question ? prev.slice(0, -1) : prev
        optimisticFloorRef.current = next.length
        return next
      })
      void ask(question, timezone)
    },
    [ask, failedQuestion],
  )

  const clear = useCallback(async () => {
    abortRef.current?.abort()
    setIsClearing(true)
    setLocalMessages([])
    optimisticFloorRef.current = 0
    setPending(null)
    setStatus('idle')
    setError(null)
    setFailedQuestion(null)
    try {
      await resetConversation()
      await qc.invalidateQueries({ queryKey: queryKeys.ai.conversation() })
    } catch (err: unknown) {
      toast.error(translateBackendError(err, 'Could not clear the conversation.'))
      await qc.invalidateQueries({ queryKey: queryKeys.ai.conversation() })
    } finally {
      setIsClearing(false)
    }
  }, [qc])

  const confirm = useCallback(
    async (callId: string, action: 'confirm' | 'decline') => {
      // The confirm endpoint streams a continuation — the system reacts to the
      // tool result and may emit further tool calls for remaining steps in the
      // user's original multi-step plan. Consume it like a normal ask() turn.
      //
      // A synchronous ref beats the state-based pendingConfirm guard, which a
      // fast double-tap can slip past before the commit lands.
      if (confirmInFlightRef.current) return
      confirmInFlightRef.current = true
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setError(null)
      setStatus('streaming')
      setPendingConfirm({ callId, action })
      const draft: AiMessage = emptyMessage('assistant')
      setPending(draft)

      try {
        for await (const event of confirmStream(callId, action, controller.signal)) {
          if (event.type === 'sources') {
            const seen = new Set(draft.sources.map((s) => `${s.kind}:${s.id}`))
            const incoming = event.sources.filter((s) => !seen.has(`${s.kind}:${s.id}`))
            draft.sources = [...draft.sources, ...incoming]
            setPending({ ...draft })
          } else if (event.type === 'token') {
            draft.text += event.text
            setPending({ ...draft })
          } else if (event.type === 'tool_call') {
            const toolCall: AiToolCall = {
              callId: event.callId,
              name: event.name,
              args: event.args,
              status: event.needsConfirmation ? 'pending_confirmation' : 'executed',
              result: null,
              error: null,
            }
            draft.toolCalls = [...draft.toolCalls, toolCall]
            setPending({ ...draft })
          } else if (event.type === 'tool_result') {
            // The first tool_result is the original deferred call — flip its
            // status on the EXISTING assistant message (not the new draft).
            const isOriginal = event.callId === callId
            if (isOriginal) {
              setLocalMessages((prev) =>
                prev.map((m) => ({
                  ...m,
                  toolCalls: m.toolCalls.map((t) =>
                    t.callId === callId
                      ? {
                          ...t,
                          status: event.error
                            ? 'failed'
                            : action === 'decline'
                              ? 'declined'
                              : 'executed',
                          result: event.result,
                          error: event.error,
                        }
                      : t,
                  ),
                })),
              )
              // TODO(tasks-query): patch the tasks cache from the confirmed
              // destructive tool here once a /tasks query exists.
            } else {
              draft.toolCalls = draft.toolCalls.map((t) =>
                t.callId === event.callId
                  ? { ...t, status: event.error ? 'failed' : 'executed', result: event.result, error: event.error }
                  : t,
              )
              setPending({ ...draft })
            }
          } else if (event.type === 'quota') {
            setQuotas(event.quotas)
          } else if (event.type === 'done') {
            setStatus('done')
          } else if (event.type === 'error') {
            setError(event.message)
            setStatus('error')
          }
        }
        // Commit the draft as a new assistant message only if the system
        // actually said something or fired new tools — a pure decline/no-op
        // leaves pending empty and we drop it.
        if (draft.text.length > 0 || draft.toolCalls.length > 0) {
          setLocalMessages((prev) => {
            const next = [...prev, draft]
            optimisticFloorRef.current = next.length
            return next
          })
        }
        setPending(null)
        await qc.invalidateQueries({ queryKey: queryKeys.ai.conversation() })
        await qc.invalidateQueries({ queryKey: queryKeys.ai.quota() })
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        setPending(null)
      } finally {
        setPendingConfirm(null)
        confirmInFlightRef.current = false
      }
    },
    [qc],
  )

  return {
    status,
    messages: localMessages,
    pending,
    pendingConfirm,
    isLoadingConversation: conv.isLoading,
    conversationError: conv.error,
    refetchConversation: () => void conv.refetch(),
    isClearing,
    error,
    failedQuestion,
    quotas,
    ask,
    retry,
    clear,
    confirm,
  }
}
