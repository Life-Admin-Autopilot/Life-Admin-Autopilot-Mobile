import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../../models/Task'
import { signUp } from '../../test/helpers'
import { appendTurn, findPendingToolCall, recentTurns } from './conversationService'
import { peekPendingCall } from './pendingToolStore'
import type { StreamEvent } from './provider/streamPersonal'

// The orchestration loop in service.ts is the load-bearing seam: it streams
// from Gemini, dispatches non-destructive tools inline, feeds tool_results
// back as functionResponses for a follow-up round, queues destructive tools
// for confirmation, and terminates after MAX_TOOL_ROUND_TRIPS. We exercise
// all of that WITHOUT a network by stubbing the two provider modules:
//   - getGeminiClient: returns a harmless sentinel so the real lazy client
//     never tries to read GEMINI_API_KEY (absent in test).
//   - streamPersonal: a scripted async generator. Each call to it shifts the
//     next "round script" off a queue, so a single test can drive multiple
//     model rounds (tool_call → tool_result → resume → final text).
//
// Everything else (buildPersonalContext, conversation persistence, the real
// toolRunner against Mongo) runs for real, so the assertions reflect the
// FINAL wired behavior end-to-end inside the service.

// Every test drives one thread; ask() now requires the id explicitly.
const THREAD = 'test-thread'

const SENTINEL_CLIENT = { __sentinel: true } as const

vi.mock('./provider/geminiClient', () => ({
  getGeminiClient: () => SENTINEL_CLIENT,
  isAiConfigured: () => true,
  __resetGeminiClientForTests: () => {},
}))

// Queue of scripted rounds. streamPersonal() consumes the head of the queue
// on each invocation and replays its events in order. The harness also records
// the contents array it was handed each round so a test can assert what got
// fed back to the model (functionResponse parts, etc.).
let roundScripts: StreamEvent[][] = []
const streamCalls: Array<{ contents: unknown[]; systemInstruction: string }> = []

vi.mock('./provider/streamPersonal', () => ({
  streamPersonal: vi.fn(async function* (args: {
    contents: unknown[]
    systemInstruction: string
  }): AsyncGenerator<StreamEvent> {
    streamCalls.push({
      // snapshot the contents at call time — service.ts mutates the array
      // between rounds, so a reference would show the final state on all rounds.
      contents: JSON.parse(JSON.stringify(args.contents)),
      systemInstruction: args.systemInstruction,
    })
    const script = roundScripts.shift() ?? [{ kind: 'done', usage: {} }]
    for (const ev of script) {
      yield ev
    }
  }),
}))

// Import the system under test AFTER the mocks are registered. Loaded in
// beforeAll (not a top-level await) so tsc accepts it under the CommonJS module
// target while still binding after vi.mock registration.
let ask: typeof import('./service').ask
let continueAfterConfirm: typeof import('./service').continueAfterConfirm
beforeAll(async () => {
  const mod = await import('./service')
  ask = mod.ask
  continueAfterConfirm = mod.continueAfterConfirm
})

function resetHarness(): void {
  roundScripts = []
  streamCalls.length = 0
}

async function drain(
  gen: AsyncGenerator<{ kind: string; [k: string]: unknown }>,
): Promise<Array<{ kind: string; [k: string]: unknown }>> {
  const out: Array<{ kind: string; [k: string]: unknown }> = []
  for await (const ev of gen) out.push(ev)
  return out
}

beforeEach(() => {
  resetHarness()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ask() — single round, no tools', () => {
  it('streams tokens, persists the assistant turn, and ends with done', async () => {
    const session = await signUp()
    roundScripts = [
      [
        { kind: 'token', text: 'Hello ' },
        { kind: 'token', text: 'there.' },
        { kind: 'done', usage: { totalTokenCount: 12 } },
      ],
    ]

    const events = await drain(ask({ userId: session.userId, conversationId: THREAD, question: 'hi there friend' }))

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('sources')
    expect(kinds).toContain('token')
    expect(kinds[kinds.length - 1]).toBe('done')

    const done = events.find((e) => e.kind === 'done')
    expect(done?.usage).toMatchObject({ totalTokenCount: 12 })

    // Only one model round ran (no tools to feed back).
    expect(streamCalls).toHaveLength(1)

    // Assistant text was persisted to the conversation.
    const turns = await recentTurns({ userId: session.userId, scope: 'personal', scopeId: THREAD }, 10)
    const assistant = turns.find((t) => t.role === 'assistant')
    expect(assistant?.text).toBe('Hello there.')
  })
})

describe('ask() — tool round-trip feeds functionResponse back', () => {
  it('runs a non-destructive tool, feeds its result back, and runs a follow-up round', async () => {
    const session = await signUp()
    // Round 1: the model calls createTask. Round 2: it produces final prose
    // after seeing the functionResponse.
    roundScripts = [
      [
        {
          kind: 'tool_call',
          name: 'createTask',
          args: { title: 'Renew passport', domain: 'home', priority: 'normal' },
        },
        { kind: 'done', usage: {} },
      ],
      [
        { kind: 'token', text: 'Added it.' },
        { kind: 'done', usage: { totalTokenCount: 30 } },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'remind me to renew my passport' }),
    )

    // Two model rounds: the second only happens because the first emitted a
    // tool whose result was fed back as a functionResponse.
    expect(streamCalls).toHaveLength(2)

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('tool_call')
    expect(kinds).toContain('tool_result')

    // The tool actually created a row.
    const task = await Task.findOne({ userId: session.userId, title: 'Renew passport' })
    expect(task).not.toBeNull()

    // Round 2's contents must contain a functionResponse echoing the tool name.
    const round2 = streamCalls[1]
    const serialized = JSON.stringify(round2?.contents)
    expect(serialized).toContain('functionResponse')
    expect(serialized).toContain('createTask')

    // The follow-up prose was streamed and persisted.
    const turns = await recentTurns({ userId: session.userId, scope: 'personal', scopeId: THREAD }, 10)
    const assistant = turns.find((t) => t.role === 'assistant')
    expect(assistant?.text).toBe('Added it.')
  })
})

describe('ask() — freshly-created task id is a citable source', () => {
  it('emits the created task as a source so [task:<id>] resolves to a chip', async () => {
    const session = await signUp()
    roundScripts = [
      [
        {
          kind: 'tool_call',
          name: 'createTask',
          args: { title: 'Book dentist', domain: 'health', priority: 'normal' },
        },
        { kind: 'done', usage: {} },
      ],
      [
        { kind: 'token', text: 'Done.' },
        { kind: 'done', usage: {} },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'add a task to book the dentist' }),
    )

    const task = await Task.findOne({ userId: session.userId, title: 'Book dentist' })
    expect(task).not.toBeNull()
    const createdId = task!.id

    // A `sources` event carrying the freshly-created task id must be emitted
    // mid-stream (the citation allow-list expansion the loop performs).
    const sourceEvents = events.filter((e) => e.kind === 'sources')
    const allSourceIds = sourceEvents.flatMap((e) =>
      (e.sources as Array<{ id: string }>).map((s) => s.id),
    )
    expect(allSourceIds).toContain(createdId)

    // It must also be merged into the persisted assistant turn's sources.
    const turns = await recentTurns({ userId: session.userId, scope: 'personal', scopeId: THREAD }, 10)
    const assistant = turns.find((t) => t.role === 'assistant')
    const persistedIds = (assistant?.sources ?? []).map((s) => s.id)
    expect(persistedIds).toContain(createdId)
  })
})

describe('ask() — bulk delete is the one remaining confirmation guard', () => {
  it('queues deleteAllTasks in the pending store and stops the loop', async () => {
    const session = await signUp()
    await Task.create({
      userId: session.userId,
      title: 'keep me',
      domain: 'home',
      status: 'open',
    })
    roundScripts = [
      [
        { kind: 'tool_call', name: 'deleteAllTasks', args: {} },
        { kind: 'done', usage: {} },
      ],
      // A second round is scripted but must NEVER run — the deferred wipe ends
      // the loop until the user confirms.
      [{ kind: 'token', text: 'should not appear' }, { kind: 'done', usage: {} }],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'delete everything' }),
    )

    // Exactly one model round — the loop stopped at the deferred wipe.
    expect(streamCalls).toHaveLength(1)

    const toolCall = events.find((e) => e.kind === 'tool_call') as
      | { callId: string; needsConfirmation: boolean }
      | undefined
    expect(toolCall?.needsConfirmation).toBe(true)
    // No tool_result for the deferred call — it hasn't run yet.
    expect(events.some((e) => e.kind === 'tool_result')).toBe(false)

    const pending = peekPendingCall(toolCall!.callId)
    expect(pending?.name).toBe('deleteAllTasks')

    // Nothing was wiped — the matter is untouched until confirmation.
    expect(await Task.countDocuments({ userId: session.userId })).toBe(1)

    const recorded = await findPendingToolCall({
      key: { userId: session.userId, scope: 'personal', scopeId: THREAD },
      callId: toolCall!.callId,
    })
    expect(recorded?.status).toBe('pending_confirmation')
  })

  it('runs updateTask INLINE now — no confirmation, the agent just acts', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'old name',
      domain: 'home',
      status: 'open',
    })
    roundScripts = [
      [
        {
          kind: 'tool_call',
          name: 'updateTask',
          args: { taskId: task.id, title: 'new name' },
        },
        { kind: 'done', usage: {} },
      ],
      [{ kind: 'token', text: 'Renamed.' }, { kind: 'done', usage: {} }],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'rename that task' }),
    )

    const toolCall = events.find((e) => e.kind === 'tool_call') as
      | { needsConfirmation: boolean }
      | undefined
    expect(toolCall?.needsConfirmation).toBe(false)
    // It ran: a tool_result was emitted and the loop resumed for a second round.
    expect(events.some((e) => e.kind === 'tool_result')).toBe(true)
    expect(streamCalls).toHaveLength(2)

    const updated = await Task.findById(task.id)
    expect(updated?.title).toBe('new name')
  })
})

describe('ask() — unknown tool', () => {
  it('emits a kind:error event and terminates the loop', async () => {
    const session = await signUp()
    roundScripts = [
      [
        { kind: 'tool_call', name: 'launchRocket', args: {} },
        { kind: 'done', usage: {} },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'do something weird' }),
    )

    const err = events.find((e) => e.kind === 'error') as
      | { code: string; message: string }
      | undefined
    expect(err).toBeDefined()
    expect(err?.code).toBe('unknown_tool')
    expect(err?.message).toContain('launchRocket')

    // No second round — the unknown tool short-circuits the generator.
    expect(streamCalls).toHaveLength(1)
  })
})

describe('ask() — tool error is fed back, not swallowed', () => {
  it('reports the tool failure as a tool_result error and resumes the loop', async () => {
    const session = await signUp()
    // completeTask against a non-existent (but well-formed) id → 404 inside the
    // tool. The loop must surface the error AND feed it back so the model can
    // recover on the next round.
    roundScripts = [
      [
        {
          kind: 'tool_call',
          name: 'completeTask',
          args: { taskId: '507f1f77bcf86cd799439011' },
        },
        { kind: 'done', usage: {} },
      ],
      [
        { kind: 'token', text: "Couldn't find that one." },
        { kind: 'done', usage: {} },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'mark that done' }),
    )

    const toolResult = events.find((e) => e.kind === 'tool_result') as
      | { error: string | null; result: unknown }
      | undefined
    expect(toolResult?.result).toBeNull()
    expect(typeof toolResult?.error).toBe('string')

    // The error was fed back as a functionResponse with an error payload and a
    // recovery round ran.
    expect(streamCalls).toHaveLength(2)
    const round2 = JSON.stringify(streamCalls[1]?.contents)
    expect(round2).toContain('functionResponse')
    expect(round2).toContain('error')
  })
})

describe('ask() — MAX_TOOL_ROUND_TRIPS termination', () => {
  it('stops after the cap even if the model keeps calling tools', async () => {
    const session = await signUp()
    // The model calls a non-destructive read tool on EVERY round forever. The
    // loop runs at most MAX_TOOL_ROUND_TRIPS + 1 (the +1 is the final guard
    // iteration that breaks when the cap is hit). We script far more rounds
    // than the cap to prove the loop is bounded by the cap, not the queue.
    const infiniteRound: StreamEvent[] = [
      { kind: 'tool_call', name: 'queryTasks', args: {} },
      { kind: 'done', usage: {} },
    ]
    roundScripts = Array.from({ length: 20 }, () =>
      infiniteRound.map((e) => ({ ...e })),
    )

    await drain(ask({ userId: session.userId, conversationId: THREAD, question: 'show my tasks repeatedly' }))

    // MAX_TOOL_ROUND_TRIPS = 4 → the for-loop runs rounds 0..4 inclusive = 5
    // stream calls. It must not have consumed the whole 20-round queue.
    expect(streamCalls).toHaveLength(5)
  })
})

describe('continueAfterConfirm() — reconstructs args from the confirmed call', () => {
  it('injects the functionCall + functionResponse pair and runs a follow-up round', async () => {
    const session = await signUp()
    // Seed a prior assistant turn so recentTurns has thread context.
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      scopeId: THREAD,
      role: 'user',
      text: 'delete that task',
    })
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      scopeId: THREAD,
      role: 'assistant',
      text: "I'll remove that.",
    })

    const deletedId = '507f1f77bcf86cd799439099'
    // The confirm route hands continueAfterConfirm the recovered args + result.
    roundScripts = [
      [
        { kind: 'token', text: 'Removed it for you.' },
        { kind: 'done', usage: { totalTokenCount: 9 } },
      ],
    ]

    const events = await drain(
      continueAfterConfirm({
        userId: session.userId,
        conversationId: THREAD,
        callId: 'call-xyz',
        toolName: 'deleteTask',
        toolArgs: { taskId: deletedId },
        toolResult: { taskId: deletedId, deleted: true },
        toolError: null,
      }),
    )

    const kinds = events.map((e) => e.kind)
    expect(kinds[kinds.length - 1]).toBe('done')

    // The single model round must have been handed the synthetic
    // functionCall (with the reconstructed args) + functionResponse pair.
    expect(streamCalls).toHaveLength(1)
    const serialized = JSON.stringify(streamCalls[0]?.contents)
    expect(serialized).toContain('functionCall')
    expect(serialized).toContain('functionResponse')
    expect(serialized).toContain('deleteTask')
    expect(serialized).toContain(deletedId)

    // The continuation's prose was persisted as a new assistant turn.
    const turns = await recentTurns({ userId: session.userId, scope: 'personal', scopeId: THREAD }, 10)
    const assistant = [...turns].reverse().find((t) => t.role === 'assistant')
    expect(assistant?.text).toBe('Removed it for you.')
  })

  it('feeds the tool error into the functionResponse when the confirmed tool failed', async () => {
    const session = await signUp()
    await appendTurn({
      userId: session.userId,
      scope: 'personal',
      scopeId: THREAD,
      role: 'user',
      text: 'delete it',
    })
    roundScripts = [
      [
        { kind: 'token', text: "That one's already gone." },
        { kind: 'done', usage: {} },
      ],
    ]

    await drain(
      continueAfterConfirm({
        userId: session.userId,
        conversationId: THREAD,
        callId: 'call-err',
        toolName: 'deleteTask',
        toolArgs: { taskId: '507f1f77bcf86cd799439011' },
        toolResult: null,
        toolError: 'Task no longer exists.',
      }),
    )

    // The functionResponse payload must carry the error (not null) so the
    // model can react to the failure.
    const serialized = JSON.stringify(streamCalls[0]?.contents)
    expect(serialized).toContain('Task no longer exists.')
  })
})

// The turn's text reaches the user WHILE the model is writing it, but a round
// that also called tools was guessing — its narration is retracted rather than
// left standing next to the corrected answer. The contract the client relies
// on: replaying (token | text_reset) in order must end at exactly the text the
// turn persisted.
describe('ask() — live token streaming and retraction', () => {
  // Replay the stream the way the client does, so the assertion is about what
  // the user is left looking at rather than about event bookkeeping.
  function renderedText(events: Array<{ kind: string; [k: string]: unknown }>): string {
    let text = ''
    for (const ev of events) {
      if (ev.kind === 'token') text += ev.text as string
      else if (ev.kind === 'text_reset') text = ''
    }
    return text
  }

  it('emits each delta as it arrives instead of one buffered blob', async () => {
    const session = await signUp()
    roundScripts = [
      [
        { kind: 'token', text: 'Your passport ' },
        { kind: 'token', text: 'expires in June.' },
        { kind: 'done', usage: {} },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'when does it expire' }),
    )

    const tokens = events.filter((e) => e.kind === 'token')
    expect(tokens).toHaveLength(2)
    expect(tokens[0]?.text).toBe('Your passport ')
    expect(renderedText(events)).toBe('Your passport expires in June.')
    // Nothing to retract — the round never called a tool.
    expect(events.some((e) => e.kind === 'text_reset')).toBe(false)
  })

  it('retracts a tool-calling round\'s narration and keeps the post-tool answer', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'old name',
      domain: 'home',
      status: 'open',
    })
    roundScripts = [
      [
        // The guess, made before the tool ran.
        { kind: 'token', text: 'I think that one is already renamed.' },
        {
          kind: 'tool_call',
          name: 'updateTask',
          args: { taskId: task.id, title: 'new name' },
        },
        { kind: 'done', usage: {} },
      ],
      [{ kind: 'token', text: 'Renamed.' }, { kind: 'done', usage: {} }],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'rename that task' }),
    )

    expect(events.some((e) => e.kind === 'text_reset')).toBe(true)
    // The guess is gone; only the answer written after the tool ran remains.
    expect(renderedText(events)).toBe('Renamed.')

    // And what the user is left looking at is what we persisted.
    const turns = await recentTurns(
      { userId: session.userId, scope: 'personal', scopeId: THREAD },
      10,
    )
    const assistant = [...turns].reverse().find((t) => t.role === 'assistant')
    expect(assistant?.text).toBe('Renamed.')
  })

  it('restores retracted text when the final round adds none of its own', async () => {
    const session = await signUp()
    await Task.create({
      userId: session.userId,
      title: 'keep me',
      domain: 'home',
      status: 'open',
    })
    // Round 1 narrates AND defers a destructive tool, which ends the loop — so
    // no later round ever streams a replacement. The retracted text is still
    // the turn's answer, so it has to come back before `done`.
    roundScripts = [
      [
        { kind: 'token', text: 'That will clear everything.' },
        { kind: 'tool_call', name: 'deleteAllTasks', args: {} },
        { kind: 'done', usage: {} },
      ],
    ]

    const events = await drain(
      ask({ userId: session.userId, conversationId: THREAD, question: 'delete everything' }),
    )

    expect(renderedText(events)).toBe('That will clear everything.')

    const turns = await recentTurns(
      { userId: session.userId, scope: 'personal', scopeId: THREAD },
      10,
    )
    const assistant = [...turns].reverse().find((t) => t.role === 'assistant')
    expect(assistant?.text).toBe('That will clear everything.')
  })
})
