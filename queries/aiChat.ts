// The chat turn state machine — wraps the SSE iterator with React state.
//
// Owns the optimistic user bubble, the accumulating assistant draft, tool-call
// confirmation, stop, retry, and the thread the turn belongs to. A ref-tracked
// AbortController means a fresh ask()/confirm() aborts any in-flight stream.
//
// A turn's tool calls mutate the very matters the rest of the app is showing,
// so the turn is also a cache event: see invalidateAfterTools.

'use client'

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import { applyDraftEvent, applyToolResult, emptyMessage, isSilent } from '@/lib/ai/draft'
import { askStream, confirmStream } from '@/lib/ai/stream'
import { fetchThread } from '@/lib/ai/conversation'
import { useActiveThreadStore } from '@/lib/ai/activeThreadStore'
import { ApiError } from '@/lib/api/client'
import { staticMessages } from '@/lib/i18n/staticMessages'
import { queryKeys } from '@/queries/keys'
import { useAiThread, useResolvedThreadId } from '@/queries/ai'
import { adjustNeedsInput } from '@/queries/tasks'
import type { AiMessage, AiQuotaRow, AiToolName } from '@/lib/ai/types'

export type AiStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface UseAskAiResult {
  status: AiStatus
  /** The thread being shown. Null only before the first thread exists. */
  conversationId: string | null
  messages: AiMessage[]
  /** Current in-flight assistant draft (tokens accumulating). */
  pending: AiMessage | null
  isLoadingConversation: boolean
  conversationError: unknown
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
  /** Abandon the in-flight turn and show what the server actually recorded. */
  stop: () => Promise<void>
  confirm: (callId: string, action: 'confirm' | 'decline') => Promise<void>
}

// Tell the rest of the app what a chat turn just changed.
//
// The chat island floats OVER the current screen — the dashboard stays mounted
// behind it — so a turn that files a matter or holds a question is editing a
// surface the user is already looking at. Without this, "Needs you" kept its
// pre-turn shape until the digest's 60s stale window lapsed, which read as the
// app having ignored what was just said. No socket is involved on purpose: this
// client made the change, so it already knows. A socket only earns its keep for
// changes THIS client didn't make (the reminder worker firing, another device).
//
// Flushed once at the end of the turn rather than per tool_result: "break this
// down" fires five addSubtask calls, and five digest refetches to render one
// change is latency the user pays for nothing.
async function invalidateAfterTools(
  qc: QueryClient,
  executed: ReadonlySet<AiToolName>,
): Promise<void> {
  // queryTasks reads; it never invalidates anything.
  const mutating = [...executed].filter((name) => name !== 'queryTasks')
  if (mutating.length === 0) return

  const jobs = [
    qc.invalidateQueries({ queryKey: queryKeys.tasks.all }),
    // Every dashboard count (including the "Needs you" strip) is digest-derived.
    qc.invalidateQueries({ queryKey: queryKeys.digestAll }),
  ]
  // holdForClarification adds a question; the bulk wipe drops every open one.
  if (mutating.some((n) => n === 'holdForClarification' || n === 'deleteAllTasks')) {
    jobs.push(qc.invalidateQueries({ queryKey: queryKeys.clarifications }))
  }
  await Promise.all(jobs)
}

export function useAskAi(): UseAskAiResult {
  const qc = useQueryClient()
  const conversationId = useResolvedThreadId()
  const setActiveId = useActiveThreadStore((s) => s.setActiveId)
  const thread = useAiThread(conversationId)

  const [status, setStatus] = useState<AiStatus>('idle')
  const [pending, setPending] = useState<AiMessage | null>(null)
  const [localMessages, setLocalMessages] = useState<AiMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [failedQuestion, setFailedQuestion] = useState<string | null>(null)
  const [quotas, setQuotas] = useState<AiQuotaRow[] | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<
    { callId: string; action: 'confirm' | 'decline' } | null
  >(null)
  const abortRef = useRef<AbortController | null>(null)
  // Synchronous re-entry guard for confirm() — a state-based guard
  // (pendingConfirm) can read stale from a closure captured before the commit
  // lands, letting a fast double-tap slip a second confirm through.
  const confirmInFlightRef = useRef(false)

  // Which thread the local list was seeded from. Seeding happens once per
  // thread, then the local list is authoritative: every turn appends its own
  // user + finalized assistant message, and post-turn invalidations refresh the
  // cache without touching what is on screen. That avoids the reconcile churn
  // that briefly double-rendered a freshly-streamed bubble (server snapshot
  // replacing the optimistic list). Switching threads re-seeds from the new
  // thread's cache — which is why this is a thread id, not a boolean.
  //
  // State rather than a ref because it is READ DURING RENDER: this is React's
  // "store the previous value to adjust state when it changes" pattern, and a
  // ref read at render time is the thing that pattern exists to avoid.
  const [seededFor, setSeededFor] = useState<string | null>(null)

  // Adjusted during render rather than in an effect — this is state derived
  // from which thread is selected, and React's own guidance is to compute it
  // on the spot instead of painting the previous thread's transcript first and
  // correcting it a frame later. The guard makes it run once per thread
  // rather than looping.
  if (seededFor !== conversationId) {
    if (conversationId === null) {
      setSeededFor(null)
      setLocalMessages([])
      setPending(null)
      setStatus('idle')
      setError(null)
      setFailedQuestion(null)
    } else if (thread.data) {
      setSeededFor(conversationId)
      // Silent turns are also PERSISTED, so reopening a thread would resurrect
      // the blank bubbles this hook refuses to create. Dropping them on the way
      // in keeps history honest without needing the rows deleted server-side.
      setLocalMessages(
        thread.data.messages.filter((m) => m.role !== 'assistant' || !isSilent(m)),
      )
      setPending(null)
      setStatus('idle')
      setError(null)
      setFailedQuestion(null)
    }
  }

  // Abort the active stream on unmount.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Replace the local list with what the server actually recorded. Used after a
  // stop, where the client stopped reading but the server finished the turn.
  const resyncFromServer = useCallback(
    async (id: string) => {
      try {
        const fresh = await qc.fetchQuery({
          queryKey: queryKeys.ai.thread(id),
          queryFn: () => fetchThread(id),
        })
        setSeededFor(id)
        setLocalMessages(
          fresh.messages.filter((m) => m.role !== 'assistant' || !isSilent(m)),
        )
      } catch {
        // Keep whatever streamed — a failed resync must not blank the thread.
      }
    },
    [qc],
  )

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
      let draft: AiMessage = emptyMessage('assistant')
      setLocalMessages((prev) => [...prev, userMessage])
      setPending(draft)

      // tool_result carries only a callId, so the name is captured here and
      // resolved when the result lands. Only successful calls count.
      const toolNameByCallId = new Map<string, AiToolName>()
      const executed = new Set<AiToolName>()
      // Where the turn actually landed — the server's answer, which may be a
      // thread it opened for us.
      let turnThreadId = conversationId

      try {
        for await (const event of askStream({
          question: trimmed,
          timezone,
          conversationId,
          signal: controller.signal,
        })) {
          const next = applyDraftEvent(draft, event)
          if (next) {
            draft = next
            setPending(draft)
            continue
          }

          if (event.type === 'conversation') {
            turnThreadId = event.conversationId
            if (event.conversationId !== conversationId) {
              // The server opened (or picked) a thread for us. Claim it as
              // already-seeded BEFORE selecting it, or the next render would
              // re-seed on the id change and wipe the turn streaming into it.
              setSeededFor(event.conversationId)
              setActiveId(event.conversationId)
            }
          } else if (event.type === 'tool_result') {
            draft = applyToolResult(draft, event.callId, {
              status: event.error ? 'failed' : 'executed',
              result: event.result,
              error: event.error,
            })
            setPending(draft)
            const name = toolNameByCallId.get(event.callId)
            if (name && !event.error) {
              executed.add(name)
              // Don't wait for the end of the turn to show this one. The turn
              // may still be streaming prose for several seconds, and the home
              // screen is visible behind the island the whole time.
              if (name === 'holdForClarification') adjustNeedsInput(qc, 1)
            }
          } else if (event.type === 'quota') {
            setQuotas(event.quotas)
          } else if (event.type === 'done') {
            setStatus('done')
          } else if (event.type === 'error') {
            setError(event.message)
            setStatus('error')
          }

          if (event.type === 'tool_call') {
            toolNameByCallId.set(event.callId, event.name)
          }
        }
        setPending(null)

        // A turn that said nothing and did nothing is a FAILURE, not a message.
        //
        // The stream can complete cleanly — sources, done, quota — with no token
        // and no tool call: the agent's model call fails inside Langflow (a daily
        // quota is the usual reason) and the flow answers a healthy 200 carrying an
        // empty envelope, so nothing anywhere reports an error. Appending the draft
        // regardless rendered an empty bubble, which reads to the user as Kitto
        // ignoring them — they re-ask, spend another turn, and get the same silence.
        //
        // Routed into the existing error state instead, so it says so and offers the
        // one-tap Retry that already exists for a turn that threw.
        if (isSilent(draft)) {
          setStatus('error')
          setError(staticMessages().errors.aiSilentTurn)
          setFailedQuestion(trimmed)
          await qc.invalidateQueries({ queryKey: queryKeys.ai.quota() })
          return
        }

        setLocalMessages((prev) => [...prev, draft])
        // The thread list re-sorts on activity and picks up its auto-title from
        // this turn, so it refreshes even though the transcript did not come
        // from the cache.
        await qc.invalidateQueries({ queryKey: queryKeys.ai.threads() })
        if (turnThreadId) {
          await qc.invalidateQueries({ queryKey: queryKeys.ai.thread(turnThreadId) })
        }
        await qc.invalidateQueries({ queryKey: queryKeys.ai.quota() })
        await invalidateAfterTools(qc, executed)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        setPending(null)
        // A turn can die AFTER its tools ran (the model fails mid-prose), so the
        // matters it already changed still have to reach the other surfaces.
        void invalidateAfterTools(qc, executed)
        // Keep the question so the UI can offer a one-tap retry — the user's
        // bubble stays put in localMessages.
        setFailedQuestion(trimmed)
      }
    },
    [conversationId, qc, setActiveId],
  )

  const retry = useCallback(
    (timezone?: string) => {
      const question = failedQuestion
      if (!question) return
      setFailedQuestion(null)
      // Drop the orphaned user bubble from the failed turn — ask() re-appends it.
      setLocalMessages((prev) => {
        const last = prev[prev.length - 1]
        return last && last.role === 'user' && last.text === question ? prev.slice(0, -1) : prev
      })
      void ask(question, timezone)
    },
    [ask, failedQuestion],
  )

  const stop = useCallback(async () => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    setPending(null)
    setStatus('idle')
    // The server does NOT stop when the reader does — it finishes the turn and
    // persists it. Showing the truncated draft would be a lie about what Kitto
    // recorded, so the thread is re-read instead of frozen mid-sentence.
    if (conversationId) await resyncFromServer(conversationId)
  }, [conversationId, resyncFromServer])

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
      let draft: AiMessage = emptyMessage('assistant')
      setPending(draft)

      const toolNameByCallId = new Map<string, AiToolName>()
      const executed = new Set<AiToolName>()

      try {
        for await (const event of confirmStream(callId, action, controller.signal)) {
          const next = applyDraftEvent(draft, event)
          if (next) {
            draft = next
            setPending(draft)
            if (event.type === 'tool_call') toolNameByCallId.set(event.callId, event.name)
            continue
          }

          if (event.type === 'tool_result') {
            // The first tool_result is the original deferred call — flip its
            // status on the EXISTING assistant message (not the new draft).
            const isOriginal = event.callId === callId
            if (!event.error && action === 'confirm') {
              // The original call was emitted in an EARLIER turn, so its name
              // never arrived on this stream. Only one tool is ever confirmable
              // (toolRunner.requiresConfirmation), so it can be named directly.
              const name = isOriginal ? 'deleteAllTasks' : toolNameByCallId.get(event.callId)
              if (name) executed.add(name)
            }
            const outcome = {
              status: event.error
                ? ('failed' as const)
                : action === 'decline'
                  ? ('declined' as const)
                  : ('executed' as const),
              result: event.result,
              error: event.error,
            }
            if (isOriginal) {
              setLocalMessages((prev) => prev.map((m) => applyToolResult(m, callId, outcome)))
            } else {
              draft = applyToolResult(draft, event.callId, {
                ...outcome,
                status: event.error ? 'failed' : 'executed',
              })
              setPending(draft)
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
        if (!isSilent(draft)) {
          setLocalMessages((prev) => [...prev, draft])
        }
        setPending(null)
        await qc.invalidateQueries({ queryKey: queryKeys.ai.threads() })
        if (conversationId) {
          await qc.invalidateQueries({ queryKey: queryKeys.ai.thread(conversationId) })
        }
        await qc.invalidateQueries({ queryKey: queryKeys.ai.quota() })
        await invalidateAfterTools(qc, executed)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        const message =
          err instanceof ApiError ? err.message : err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        setPending(null)
        // The wipe may already have run before the continuation failed.
        void invalidateAfterTools(qc, executed)
      } finally {
        setPendingConfirm(null)
        confirmInFlightRef.current = false
      }
    },
    [conversationId, qc],
  )

  return {
    status,
    conversationId,
    messages: localMessages,
    pending,
    pendingConfirm,
    isLoadingConversation: thread.isLoading,
    conversationError: thread.error,
    error,
    failedQuestion,
    quotas,
    ask,
    retry,
    stop,
    confirm,
  }
}
