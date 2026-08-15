import { randomUUID } from 'node:crypto'

import type { Content } from '@google/genai'

import { logger } from '../../logger'
import { AppError } from '../../lib/errors'
import { buildPersonalContext, type ContextSource } from './contextBuilder'
import {
  appendTurn,
  expireStalePendingToolCalls,
  recentTurns,
} from './conversationService'
import { titleThreadFromFirstMessage } from './conversationThreads'
import { getGeminiClient } from './provider/geminiClient'
import { streamPersonal } from './provider/streamPersonal'
import { getUserAiLocale } from './userLocale'
import { registerPendingCall } from './pendingToolStore'
import {
  countTasksForBulkDelete,
  requiresConfirmation,
  runTool,
  TOOL_NAMES,
  type ToolName,
} from './toolRunner'

// AskEvent — the scope-agnostic surface the route layer pipes into SSE.

export type AskEvent =
  | { kind: 'sources'; sources: ContextSource[] }
  | { kind: 'token'; text: string }
  /**
   * Discard everything streamed for this turn so far.
   *
   * Tokens go out live, but a round that ALSO calls tools usually narrates a
   * guess first ("You have three renewals coming up…") which the post-tool
   * round then contradicts. That text is retracted rather than left standing —
   * see runToolLoop, where this replaces the old buffer-everything approach.
   */
  | { kind: 'text_reset' }
  | {
      kind: 'tool_call'
      callId: string
      name: ToolName
      args: Record<string, unknown>
      needsConfirmation: boolean
    }
  | {
      kind: 'tool_result'
      callId: string
      result: Record<string, unknown> | null
      error: string | null
    }
  | { kind: 'done'; usage: Record<string, number | undefined> }
  | { kind: 'error'; code: string; message: string }

function isKnownTool(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name)
}

// Stable key for a tool call so the same (name, args) issued again in a later
// round can be de-duplicated. Sorts object keys recursively so arg ordering
// doesn't defeat the match.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
const toolCallKey = (name: string, args: Record<string, unknown>): string =>
  `${name}|${stableStringify(args)}`

interface AskArgs {
  userId: string
  /** Which thread this turn belongs to. Routes resolve it before calling. */
  conversationId: string
  question: string
  timezone?: string
}

interface ContinueAfterConfirmArgs {
  userId: string
  /**
   * Null when the pending call lives in a legacy thread that listThreads() has
   * not adopted yet — the store treats null as a real key, so it is passed
   * through rather than coerced.
   */
  conversationId: string | null
  callId: string
  toolName: ToolName
  toolArgs: Record<string, unknown>
  toolResult: Record<string, unknown> | null
  toolError: string | null
  timezone?: string
}

const STALE_PENDING_MS = 60 * 60 * 1000

// Max round-trips of (tool_call → tool_result → resume) per turn. Without a
// cap a misbehaving model could loop indefinitely on a tool error.
const MAX_TOOL_ROUND_TRIPS = 4

export async function* ask(args: AskArgs): AsyncGenerator<AskEvent> {
  // Sweep stale pending calls before reading history so we never ship
  // unpaired functionCall parts into Gemini's contents array.
  await expireStalePendingToolCalls(
    { userId: args.userId, scope: 'personal', scopeId: args.conversationId },
    STALE_PENDING_MS,
  )

  // Persist the user turn BEFORE streaming starts so a mid-stream
  // disconnect still leaves the question in history.
  await appendTurn({
    userId: args.userId,
    scope: 'personal',
    scopeId: args.conversationId,
    role: 'user',
    text: args.question,
  })

  // Name the thread from the sentence that opened it. No-op on every turn
  // after the first, and on a thread the user has renamed themselves.
  await titleThreadFromFirstMessage(args.userId, args.conversationId, args.question)

  const ctx = await buildPersonalContext({
    userId: args.userId,
    question: args.question,
    timezone: args.timezone,
    locale: await getUserAiLocale(args.userId),
  })

  yield { kind: 'sources', sources: ctx.sources }

  const historyN = ctx.mode === 'greeting' ? 0 : ctx.mode === 'conversation' ? 6 : 11
  const history = await recentTurns(
    { userId: args.userId, scope: 'personal', scopeId: args.conversationId },
    historyN + 1, // +1 so the user turn we just appended is included
  )

  // Build Gemini contents: prefill + history (excluding the user turn we'll
  // re-append below as the structured `ctx.user`) + the current user turn.
  const contents: Content[] = []
  contents.push(...ctx.prefillContents)

  // Convert history turns to Gemini Content shape. Skip the trailing user
  // turn (we re-add the current question as the final entry with the
  // grounded scaffold).
  for (let i = 0; i < history.length - 1; i++) {
    const turn = history[i]
    if (!turn) continue
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    })
  }
  contents.push({ role: 'user', parts: [{ text: ctx.user }] })

  const loopOut = yield* runToolLoop({
    userId: args.userId,
    timezone: args.timezone,
    systemInstruction: ctx.system,
    contents,
    sourceText: args.question,
  })

  await appendTurn({
    userId: args.userId,
    scope: 'personal',
    scopeId: args.conversationId,
    role: 'assistant',
    text: loopOut.assistantText,
    sources: [...ctx.sources, ...loopOut.newSources],
    toolCalls: loopOut.toolCallsForTurn.map((t) => ({
      callId: t.callId,
      name: t.name,
      args: t.args,
      status: t.status,
      result: t.result ?? null,
      error: t.error ?? null,
    })),
  })

  yield { kind: 'done', usage: loopOut.usage }

  void logger
}

// Resume the conversation after the user confirmed (or declined) a
// destructive tool call from a prior turn. Builds a fresh Gemini context,
// injects the synthetic functionCall + functionResponse pair so the model
// sees the just-completed work, and continues the orchestration loop so
// any follow-up actions in the user's original multi-step plan can run.
export async function* continueAfterConfirm(
  args: ContinueAfterConfirmArgs,
): AsyncGenerator<AskEvent> {
  await expireStalePendingToolCalls(
    { userId: args.userId, scope: 'personal', scopeId: args.conversationId },
    STALE_PENDING_MS,
  )

  // Reconstruct context from current state. Use the LAST user message as
  // the grounded scaffold question so the data block stays warm. We don't
  // append a new user turn — the "user message" here is the synthetic
  // functionResponse we'll add below.
  const recent = await recentTurns(
    { userId: args.userId, scope: 'personal', scopeId: args.conversationId },
    12,
  )
  const lastUserTurn = [...recent].reverse().find((t) => t.role === 'user')
  const question = lastUserTurn?.text ?? '(continue)'

  const ctx = await buildPersonalContext({
    userId: args.userId,
    question,
    timezone: args.timezone,
    locale: await getUserAiLocale(args.userId),
  })

  yield { kind: 'sources', sources: ctx.sources }

  const contents: Content[] = []
  contents.push(...ctx.prefillContents)
  // Reproject history as text-only turns, just like ask() does.
  for (let i = 0; i < recent.length - 1; i++) {
    const turn = recent[i]
    if (!turn) continue
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text }],
    })
  }
  contents.push({ role: 'user', parts: [{ text: ctx.user }] })

  // The model's previous turn included the functionCall that the user
  // just confirmed. We need that functionCall paired with a synthetic
  // functionResponse so Gemini can react. Text content of that prior
  // turn is already in `recent` history above; here we just add the
  // structural call/response pair as a NEW model→user exchange so the
  // pairing parses cleanly.
  contents.push({
    role: 'model',
    parts: [
      {
        functionCall: {
          name: args.toolName,
          args: args.toolArgs,
        },
      },
    ],
  })
  contents.push({
    role: 'user',
    parts: [
      {
        functionResponse: {
          name: args.toolName,
          response:
            args.toolResult ?? { error: args.toolError ?? 'unknown' },
        },
      },
    ],
  })

  const loopOut = yield* runToolLoop({
    userId: args.userId,
    timezone: args.timezone,
    systemInstruction: ctx.system,
    contents,
    // The turn the user confirmed grew out of their last real message; '(continue)'
    // is our own placeholder and would be a lie to quote back at them.
    sourceText: lastUserTurn?.text,
  })

  await appendTurn({
    userId: args.userId,
    scope: 'personal',
    scopeId: args.conversationId,
    role: 'assistant',
    text: loopOut.assistantText,
    sources: [...ctx.sources, ...loopOut.newSources],
    toolCalls: loopOut.toolCallsForTurn.map((t) => ({
      callId: t.callId,
      name: t.name,
      args: t.args,
      status: t.status,
      result: t.result ?? null,
      error: t.error ?? null,
    })),
  })

  yield { kind: 'done', usage: loopOut.usage }
}

interface ToolLoopArgs {
  userId: string
  timezone?: string
  systemInstruction: string
  contents: Content[]
  /**
   * The user's message for this turn, verbatim — passed to the tool runner so a
   * `holdForClarification` row can quote it back on /uncertainties. Deliberately
   * NOT the grounded scaffold (`ctx.user`), which wraps the question in a data
   * block the user never wrote.
   */
  sourceText?: string
}

interface ToolLoopOutput {
  assistantText: string
  toolCallsForTurn: Array<{
    callId: string
    name: ToolName
    args: Record<string, unknown>
    status: 'executed' | 'failed' | 'pending_confirmation'
    result?: Record<string, unknown> | null
    error?: string | null
  }>
  /** Sources newly created during this turn (e.g. createTask results).
   *  Merged into the persisted assistant turn's `sources` so any
   *  [task:<id>] citation Kitto emits resolves to a friendly chip on render
   *  instead of falling through to (unverified). */
  newSources: ContextSource[]
  usage: Record<string, number | undefined>
}

// Extract a citable source from a tool result if it produced a task. Used
// for createTask / updateTask / completeTask / snoozeTask / addSubtask /
// toggleSubtask / removeSubtask responses — anything that returns
// `{ task: {...} }`.
function sourceFromToolResult(
  result: Record<string, unknown>,
): ContextSource | null {
  const t = result.task as Record<string, unknown> | undefined
  if (!t) return null
  const id = typeof t.id === 'string' ? t.id : null
  const title = typeof t.title === 'string' ? t.title : null
  if (!id || !title) return null
  return { kind: 'task', id, title }
}

// Shared orchestrator loop. Streams tokens and tool calls from Gemini,
// dispatches non-destructive tools inline, queues destructive ones for
// user confirmation, and feeds tool results back into the model for the
// next round. Used by both ask() (fresh turn) and continueAfterConfirm()
// (post-confirmation resumption).
async function* runToolLoop(
  args: ToolLoopArgs,
): AsyncGenerator<AskEvent, ToolLoopOutput> {
  const client = getGeminiClient()
  let assistantText = ''
  // What the client currently has on screen for this turn, after any
  // retraction. Kept in step with every token/text_reset yielded below so the
  // reconciliation at the end can compare it against the persisted answer.
  let liveText = ''
  const toolCallsForTurn: ToolLoopOutput['toolCallsForTurn'] = []
  const newSources: ContextSource[] = []
  const seenSourceIds = new Set<string>()
  // Results of non-destructive tool calls already run this turn, keyed by
  // (name, args). Lets a re-issued identical call (the model sometimes repeats
  // a read across rounds) reuse the result instead of running + streaming it
  // twice. Gemini still gets a functionResponse for the duplicate so its
  // contents stay well-formed.
  const executedResults = new Map<string, Record<string, unknown> | null>()
  let usage: Record<string, number | undefined> = {}

  for (let round = 0; round <= MAX_TOOL_ROUND_TRIPS; round++) {
    const stream = streamPersonal({
      client,
      systemInstruction: args.systemInstruction,
      contents: args.contents,
    })

    const roundParts: Array<
      { text: string } | { functionCall: { name: string; args: Record<string, unknown> } }
    > = []
    const toolInvocations: Array<{
      callId: string
      name: ToolName
      args: Record<string, unknown>
    }> = []
    let toolDeferred = false
    // This round's text, streamed to the client as it arrives.
    //
    // Live streaming and "never show a guess then contradict it" used to be in
    // conflict: a round that also calls tools usually narrates a premature
    // answer, so the old code buffered EVERY round and emitted one token event
    // at the very end — correct, but the user watched a spinner for the whole
    // turn. Now the text goes out live and is RETRACTED (text_reset) the moment
    // that round turns out to have called tools. The reconciliation after the
    // loop guarantees the client ends up with exactly `assistantText`, which is
    // what gets persisted.
    let roundText = ''
    let roundStreamed = false

    for await (const ev of stream) {
      if (ev.kind === 'token') {
        roundText += ev.text
        roundParts.push({ text: ev.text })
        yield { kind: 'token', text: ev.text }
        liveText += ev.text
        roundStreamed = true
      } else if (ev.kind === 'tool_call') {
        if (!isKnownTool(ev.name)) {
          yield {
            kind: 'error',
            code: 'unknown_tool',
            message: `Model called unknown tool: ${ev.name}`,
          }
          return { assistantText, toolCallsForTurn, newSources, usage }
        }
        const callId = randomUUID()
        roundParts.push({ functionCall: { name: ev.name, args: ev.args } })
        toolInvocations.push({ callId, name: ev.name, args: ev.args })
      } else if (ev.kind === 'done') {
        usage = ev.usage as Record<string, number | undefined>
      }
    }

    // Last round with text wins — the final answer overwrites any earlier
    // premature narration.
    if (roundText.trim().length > 0) assistantText = roundText

    if (toolInvocations.length === 0) break

    // This round called tools, so whatever it said was a guess made before the
    // facts landed. Retract it; the post-tool round streams the real answer.
    if (roundStreamed) {
      yield { kind: 'text_reset' }
      liveText = ''
    }

    args.contents.push({ role: 'model', parts: roundParts })

    const responseParts: Array<{
      functionResponse: { name: string; response: Record<string, unknown> }
    }> = []

    for (const inv of toolInvocations) {
      const needsConfirmation = requiresConfirmation(inv.name)

      // De-dupe identical non-destructive calls re-issued in a later round:
      // reuse the cached result, keep Gemini's contents well-formed with a
      // functionResponse, but don't run or stream it again.
      const dedupeKey = needsConfirmation ? null : toolCallKey(inv.name, inv.args)
      if (dedupeKey && executedResults.has(dedupeKey)) {
        responseParts.push({
          functionResponse: {
            name: inv.name,
            response: executedResults.get(dedupeKey) ?? { duplicate: true },
          },
        })
        continue
      }

      // Bulk delete: enrich the confirmation payload with a live count so the
      // card reads "Delete all 12 tasks" instead of a vague "all tasks". The
      // extra `count` is display-only — Zod strips it when the tool runs.
      let callArgs = inv.args
      if (needsConfirmation && inv.name === 'deleteAllTasks') {
        const count = await countTasksForBulkDelete(args.userId, inv.args)
        if (count !== null) callArgs = { ...inv.args, count }
      }

      yield {
        kind: 'tool_call',
        callId: inv.callId,
        name: inv.name,
        args: callArgs,
        needsConfirmation,
      }

      if (needsConfirmation) {
        registerPendingCall({
          callId: inv.callId,
          userId: args.userId,
          name: inv.name,
          args: callArgs,
          timezone: args.timezone,
        })
        toolCallsForTurn.push({
          callId: inv.callId,
          name: inv.name,
          args: callArgs,
          status: 'pending_confirmation',
        })
        toolDeferred = true
        continue
      }

      try {
        const out = await runTool({
          userId: args.userId,
          name: inv.name,
          args: inv.args,
          timezone: args.timezone,
          sourceText: args.sourceText,
        })
        yield {
          kind: 'tool_result',
          callId: inv.callId,
          result: out.result,
          error: null,
        }
        // Stash the affected task as a citable source so [task:<id>]
        // references in Kitto's reply resolve to friendly chips — not
        // "(unverified)". De-dupe across rounds.
        const src = sourceFromToolResult(out.result)
        if (src && !seenSourceIds.has(src.id)) {
          newSources.push(src)
          seenSourceIds.add(src.id)
          yield { kind: 'sources', sources: [src] }
        }
        responseParts.push({
          functionResponse: { name: inv.name, response: out.result },
        })
        if (dedupeKey) executedResults.set(dedupeKey, out.result)
        toolCallsForTurn.push({
          callId: inv.callId,
          name: inv.name,
          args: inv.args,
          status: 'executed',
          result: out.result,
        })
      } catch (err: unknown) {
        const message =
          err instanceof AppError ? err.message : err instanceof Error ? err.message : String(err)
        yield {
          kind: 'tool_result',
          callId: inv.callId,
          result: null,
          error: message,
        }
        responseParts.push({
          functionResponse: { name: inv.name, response: { error: message } },
        })
        toolCallsForTurn.push({
          callId: inv.callId,
          name: inv.name,
          args: inv.args,
          status: 'failed',
          error: message,
        })
      }
    }

    if (toolDeferred) break

    args.contents.push({ role: 'user', parts: responseParts })
  }

  // Reconcile: what the client is showing must equal what we persist.
  //
  // Normally these already match — the final round streamed the answer and
  // nothing retracted it, so this is a no-op. It earns its keep in the corner
  // where the LAST round produced no text of its own (a deferred confirmation,
  // a tool-only round after a retraction): `assistantText` still holds an
  // earlier round's text that the client was told to drop, and without this the
  // turn would persist a reply the user never saw.
  if (assistantText !== liveText) {
    if (liveText.length > 0) yield { kind: 'text_reset' }
    if (assistantText.length > 0) yield { kind: 'token', text: assistantText }
  }

  return { assistantText, toolCallsForTurn, newSources, usage }
}
