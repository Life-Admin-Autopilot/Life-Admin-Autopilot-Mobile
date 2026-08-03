import express, { Router } from 'express'

import { asyncHandler, AppError, BadRequest, Forbidden, NotFound, Unauthorized } from '../../lib/errors'
import { transcribeAudio } from './audioTranscriber'
import { getUserAiLocale } from './userLocale'
import { requireAuth } from '../../middleware/auth'
import { utcDateBucket } from '../../models/AiUsageCounter'
import {
  appendTurn,
  findPendingToolCall,
  loadConversation,
  resetConversation,
  resolveToolCall,
} from './conversationService'
import { isAiConfigured } from './provider/geminiClient'
import { askBodySchema, confirmToolBodySchema } from './schemas'
import { ask, continueAfterConfirm, type AskEvent } from './service'
import { admitWithinQuota, getQuotaStatus, recordUsage, releaseUsageSlot } from './quota'
import { consumePendingCall, peekPendingCall } from './pendingToolStore'
import { runConfirmedTool, validateToolArgs, type ToolName } from './toolRunner'
import { aiAskLimiter, aiConfirmLimiter, aiVoiceLimiter } from '../../middleware/rateLimit'

export const aiRouter = Router()

const SSE_HEARTBEAT_MS = 25_000

// For v1 every user is on the free tier — Pro upgrade comes later.
function resolveTier(): 'free' | 'pro' {
  return 'free'
}

aiRouter.get(
  '/ai/conversation',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const conversation = await loadConversation({
      userId: auth.sub,
      scope: 'personal',
      scopeId: null,
    })
    res.status(200).json({
      scope: 'personal' as const,
      scopeId: null,
      messages: conversation.messages.map((m) => ({
        role: m.role,
        text: m.text,
        sources: m.sources ?? [],
        toolCalls: m.toolCalls ?? [],
        createdAt: m.createdAt.toISOString(),
      })),
    })
  }),
)

aiRouter.post(
  '/ai/conversation/reset',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    await resetConversation({ userId: auth.sub, scope: 'personal', scopeId: null })
    res.status(200).json({ scope: 'personal' as const, scopeId: null, messages: [] })
  }),
)

aiRouter.get(
  '/ai/quota',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()
    const tier = resolveTier()
    const quotas = await getQuotaStatus({ userId: auth.sub, tier })
    res.status(200).json({ tier, quotas })
  }),
)

// POST /ai/ask — SSE stream. Quota gate runs BEFORE opening SSE headers
// so 402 lands as a normal JSON error response. Once SSE is open every
// error is an event with kind=error inside the stream.
aiRouter.post(
  '/ai/ask',
  requireAuth,
  // After auth so the window keys on the user id, not a shared proxy IP.
  aiAskLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const parsed = askBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid ask payload.', parsed.error.flatten())
    }

    if (!isAiConfigured()) {
      throw new AppError(
        503,
        'ai_not_configured',
        'AI is not configured. Set GEMINI_API_KEY in server/.env to enable.',
      )
    }

    const tier = resolveTier()
    const today = utcDateBucket()
    // Atomic reserve: this consumes the slot up front (closing the
    // check-then-increment race). A 402 lands as a normal JSON error before
    // SSE opens. The slot is RELEASED below if the turn fails before it
    // reaches `done`, so a crashed stream doesn't permanently burn quota.
    await admitWithinQuota({ userId: auth.sub, tier, kind: 'message', today })

    // Open SSE.
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // disables nginx buffering
    res.flushHeaders?.()

    const heartbeat = setInterval(() => {
      // SSE comment lines start with `:` — they're keep-alives and the
      // client parser ignores them. Keeps the connection alive past
      // proxy idle timeouts (nginx default 60s, Cloudflare ~100s).
      res.write(`: ping ${Date.now()}\n\n`)
    }, SSE_HEARTBEAT_MS)

    const send = (event: AskEvent | { type: string; [k: string]: unknown }) => {
      // Frontend reader expects `data: {type, ...}\n\n`.
      const normalized = 'kind' in event ? { type: event.kind, ...event } : event
      delete (normalized as { kind?: string }).kind
      res.write(`data: ${JSON.stringify(normalized)}\n\n`)
    }

    let reachedDone = false
    try {
      for await (const event of ask({
        userId: auth.sub,
        question: parsed.data.question,
        timezone: parsed.data.timezone,
      })) {
        send(event)
        if (event.kind === 'done') {
          // Slot was already consumed by admitWithinQuota — do NOT increment
          // again here. Just emit the refreshed counter.
          reachedDone = true
          const quotas = await getQuotaStatus({ userId: auth.sub, tier, today })
          send({ type: 'quota', tier, quotas })
        }
      }
    } catch (err: unknown) {
      const code = err instanceof AppError ? err.code : 'internal_error'
      const message =
        err instanceof AppError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unexpected error'
      send({ type: 'error', code, message })
    } finally {
      // Refund the reserved slot if the turn never produced a result.
      if (!reachedDone) {
        await releaseUsageSlot({ userId: auth.sub, kind: 'message', today }).catch(() => {})
      }
      clearInterval(heartbeat)
      res.end()
    }
  }),
)

// POST /ai/tools/confirm/:callId — SSE stream. Confirms (or declines) a
// destructive tool. On confirm, runs the tool, then re-enters the
// orchestrator so Kitto can react to the result and continue any remaining
// steps from the user's original multi-step plan. On decline, signals
// declined and ends the stream.
//
// Stream event shape mirrors POST /ai/ask: { type: 'tool_result' | 'token'
// | 'tool_call' | 'done' | 'error' | 'quota', ... }. Frontend consumes it
// with the same SSE parser as askAi.
aiRouter.post(
  '/ai/tools/confirm/:callId',
  requireAuth,
  // After auth so the window keys on the user id, not a shared proxy IP.
  aiConfirmLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const callId = String(req.params.callId ?? '')
    const parsed = confirmToolBodySchema.safeParse(req.body)
    if (!parsed.success) {
      throw BadRequest('invalid_body', 'Invalid confirm payload.', parsed.error.flatten())
    }

    // SOURCE OF TRUTH = the persisted AiConversation toolCall record, scoped
    // to this user. The in-memory PENDING map is only a fast cache that does
    // NOT survive a process restart — so a "Confirm delete?" turn that
    // outlives a deploy used to 404 forever. We reconstruct the call from the
    // durable record instead. The map is still consulted for the one field
    // we don't persist on the record (the caller's timezone).
    const recorded = await findPendingToolCall({
      key: { userId: auth.sub, scope: 'personal' },
      callId,
    })
    if (!recorded) {
      throw NotFound('pending_call_not_found', 'This confirmation has expired.')
    }
    // Already resolved (confirmed/declined elsewhere, or expired-and-swept to
    // declined). Only a still-pending call may be confirmed — prevents a
    // double-confirm replaying a destructive op.
    if (recorded.status !== 'pending_confirmation') {
      throw NotFound('pending_call_not_found', 'This confirmation has already been handled.')
    }

    // Cached entry (present when the process hasn't restarted). Used to
    // cross-check ownership and to recover the timezone the record doesn't
    // carry. Peek (not consume) so a declined/failed path can still find it.
    const cached = peekPendingCall(callId)
    if (cached && cached.userId !== auth.sub) {
      throw Forbidden('cross_user_confirm', 'You cannot confirm another user\'s pending call.')
    }

    // Reconstruct + RE-VALIDATE the call from the durable record. Re-running
    // validateToolArgs here is defense-in-depth: the args came back from the
    // DB and are re-checked before any destructive dispatch, and it survives
    // a restart that wiped the in-memory map.
    const recoveredName = recorded.name as ToolName
    const recoveredArgs = validateToolArgs(recoveredName, recorded.args) as Record<string, unknown>
    const recoveredTimezone = cached?.timezone
    // Clear the cache entry now that we've fully recovered the call so it
    // can't be replayed from memory after this turn resolves.
    consumePendingCall(callId)

    // Open SSE — all errors past this point are stream events, not HTTP
    // status codes.
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    const heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`)
    }, SSE_HEARTBEAT_MS)

    const send = (event: AskEvent | { type: string; [k: string]: unknown }) => {
      const normalized = 'kind' in event ? { type: event.kind, ...event } : event
      delete (normalized as { kind?: string }).kind
      res.write(`data: ${JSON.stringify(normalized)}\n\n`)
    }

    const tier = resolveTier()
    const today = utcDateBucket()

    try {
      if (parsed.data.action === 'decline') {
        await resolveToolCall({
          key: { userId: auth.sub, scope: 'personal' },
          callId,
          status: 'declined',
        })
        send({
          type: 'tool_result',
          callId,
          result: null,
          error: 'declined',
        })
        send({ type: 'done', usage: {} })
        return
      }

      // Run the confirmed tool.
      let toolResult: Record<string, unknown> | null = null
      let toolError: string | null = null
      try {
        const out = await runConfirmedTool({
          userId: auth.sub,
          name: recoveredName,
          args: recoveredArgs,
          timezone: recoveredTimezone,
        })
        toolResult = out.result
        await resolveToolCall({
          key: { userId: auth.sub, scope: 'personal' },
          callId,
          status: 'executed',
          result: out.result,
        })
      } catch (err: unknown) {
        toolError =
          err instanceof AppError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'tool failed'
        await resolveToolCall({
          key: { userId: auth.sub, scope: 'personal' },
          callId,
          status: 'failed',
          error: toolError,
        })
      }

      send({
        type: 'tool_result',
        callId,
        result: toolResult,
        error: toolError,
      })

      // Resume the conversation so Kitto can react to the tool result and
      // continue any remaining steps from the user's original message.
      // Skip if AI isn't configured (defensive — destructive tools can
      // still run, the user just won't get a follow-up message).
      if (!isAiConfigured()) {
        send({ type: 'done', usage: {} })
        return
      }

      // Don't gate the continuation on quota — it's the SAME logical turn
      // as the original ask, the user already paid for it.
      for await (const event of continueAfterConfirm({
        userId: auth.sub,
        callId,
        toolName: recoveredName,
        toolArgs: recoveredArgs,
        toolResult,
        toolError,
        timezone: recoveredTimezone,
      })) {
        send(event)
        if (event.kind === 'done') {
          // Record usage for the continuation as one additional message
          // (it's a fresh Gemini round). Keep the quota event so the UI
          // can update its counter.
          await recordUsage({ userId: auth.sub, kind: 'message', today })
          const quotas = await getQuotaStatus({ userId: auth.sub, tier, today })
          send({ type: 'quota', tier, quotas })
        }
      }
    } catch (err: unknown) {
      const code = err instanceof AppError ? err.code : 'internal_error'
      const message =
        err instanceof AppError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unexpected error'
      send({ type: 'error', code, message })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }
  }),
)

// POST /ai/voice/transcribe — sync audio → text for chat voice mode.
// Accepts RAW audio bytes (Content-Type: audio/m4a), same as /me/voice-notes.
// This is the fix for the production 413: the old base64-in-JSON envelope was
// rejected by the app-wide express.json({limit:'256kb'}) parser BEFORE this
// route ran. Raw audio carries an audio/* content-type, so the global JSON
// parser ignores it entirely — no 413, no 33% base64 inflation.
const CHAT_AUDIO_MAX_BYTES = 6 * 1024 * 1024

aiRouter.post(
  '/ai/voice/transcribe',
  // raw() ceiling above the friendly cap so oversize gets a friendly 400.
  express.raw({
    type: ['audio/m4a', 'audio/mp4', 'audio/aac', 'application/octet-stream'],
    limit: CHAT_AUDIO_MAX_BYTES * 2,
  }),
  requireAuth,
  // Per-user rate limit AFTER auth so it keys on the user id (req.auth.sub),
  // not the shared proxy IP.
  aiVoiceLimiter,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    if (!isAiConfigured()) {
      throw new AppError(
        503,
        'ai_not_configured',
        'AI is not configured. Set GEMINI_API_KEY in server/.env.',
      )
    }

    const bytes = req.body as Buffer | undefined
    if (!bytes || !Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw BadRequest('empty_body', 'No audio payload received.')
    }
    if (bytes.length > CHAT_AUDIO_MAX_BYTES) {
      throw BadRequest('payload_too_large', 'Recording exceeds 6MB. Try a shorter clip.')
    }
    const mimeType = (req.header('content-type') ?? 'audio/m4a').split(';')[0]?.trim() || 'audio/m4a'

    const tier = resolveTier()
    const today = utcDateBucket()
    // Atomic reserve before the (paid) transcription call. Refund the slot if
    // transcription throws so a provider error doesn't burn the user's quota.
    await admitWithinQuota({ userId: auth.sub, tier, kind: 'message', today })

    let text: string
    try {
      text = await transcribeAudio({
        bytes,
        mimeType,
        locale: await getUserAiLocale(auth.sub),
      })
    } catch (err: unknown) {
      await releaseUsageSlot({ userId: auth.sub, kind: 'message', today }).catch(() => {})
      throw err
    }

    res.status(200).json({ text })
  }),
)

// Phase 5 placeholder — wire append for assistant-only persistence helper
// is handled inside service.ts. This file owns route shapes only.
void appendTurn
