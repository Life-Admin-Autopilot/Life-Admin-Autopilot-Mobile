import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { signUp } from '../../test/helpers'
import { Task, notDeleted } from '../../models/Task'
import { Clarification } from '../../models/Clarification'
import {
  countTasksForBulkDelete,
  requiresConfirmation,
  runConfirmedTool,
  runTool,
  validateToolArgs,
} from './toolRunner'
import { normalizeLocalIso, STRICT_DATETIME_RE } from './timeNormalize'

describe('STRICT_DATETIME_RE', () => {
  it.each([
    '2026-05-17T18:00',
    '2026-05-17T18:00:00',
    '2026-05-17T18:00:00.123',
    '2026-05-17T18:00:00Z',
    '2026-05-17T18:00:00+03:00',
    '2026-05-17T18:00:00-05:00',
  ])('accepts %s', (iso) => {
    expect(STRICT_DATETIME_RE.test(iso)).toBe(true)
  })

  it.each([
    'tomorrow',
    '2026-05-17 18:00',
    '2026/05/17T18:00',
    '5pm',
  ])('rejects %s', (iso) => {
    expect(STRICT_DATETIME_RE.test(iso)).toBe(false)
  })
})

describe('normalizeLocalIso', () => {
  it('parses an offset-aware ISO directly', () => {
    const d = normalizeLocalIso('2026-05-17T18:00:00+03:00', 'Africa/Cairo')
    expect(d.toISOString()).toBe('2026-05-17T15:00:00.000Z')
  })

  it('anchors a naive ISO to the caller’s timezone', () => {
    // 18:00 Cairo (UTC+3) = 15:00 UTC
    const d = normalizeLocalIso('2026-05-17T18:00:00', 'Africa/Cairo')
    expect(d.toISOString()).toBe('2026-05-17T15:00:00.000Z')
  })

  it('falls back to UTC for a naive ISO without timezone', () => {
    const d = normalizeLocalIso('2026-05-17T18:00:00', undefined)
    expect(d.toISOString()).toBe('2026-05-17T18:00:00.000Z')
  })
})

describe('requiresConfirmation', () => {
  it('guards ONLY the irreversible bulk wipe — everything else is agent-driven', () => {
    expect(requiresConfirmation('deleteAllTasks')).toBe(true)
    expect(requiresConfirmation('updateTask')).toBe(false)
    expect(requiresConfirmation('deleteTask')).toBe(false)
    expect(requiresConfirmation('removeSubtask')).toBe(false)
    expect(requiresConfirmation('createTask')).toBe(false)
    expect(requiresConfirmation('completeTask')).toBe(false)
    expect(requiresConfirmation('snoozeTask')).toBe(false)
    expect(requiresConfirmation('queryTasks')).toBe(false)
  })
})

describe('validateToolArgs', () => {
  it('rejects unknown domain on createTask', () => {
    expect(() =>
      validateToolArgs('createTask', { title: 'x', domain: 'spaceship' }),
    ).toThrowError()
  })

  it('rejects naive ISO without offset on dueAt only when no tz at parse time — but always accepted at validate', () => {
    // Validation only enforces the strict regex; tz anchoring happens at run.
    expect(() =>
      validateToolArgs('createTask', {
        title: 'x',
        domain: 'home',
        dueAt: '2026-05-17T18:00',
      }),
    ).not.toThrow()
  })

  it('rejects malformed ISO on updateTask', () => {
    expect(() =>
      validateToolArgs('updateTask', {
        taskId: 'abc',
        dueAt: 'tomorrow',
      }),
    ).toThrowError()
  })

  it('rejects a reminder with no dueAt — the reminder invariant', () => {
    expect(() =>
      validateToolArgs('createTask', {
        title: 'Renew passport',
        domain: 'home',
        kind: 'reminder',
      }),
    ).toThrowError()
  })

  it('accepts a list item with no dueAt', () => {
    expect(() =>
      validateToolArgs('createTask', {
        title: 'Buy cat food',
        domain: 'pets',
        kind: 'list',
      }),
    ).not.toThrow()
  })

  it('derives kind from dueAt when omitted', () => {
    const dated = validateToolArgs('createTask', {
      title: 'Pay rent',
      domain: 'finance',
      dueAt: '2026-06-01T09:00:00+03:00',
    }) as { kind: string }
    expect(dated.kind).toBe('reminder')

    const dateless = validateToolArgs('createTask', {
      title: 'Tidy the garage',
      domain: 'home',
    }) as { kind: string }
    expect(dateless.kind).toBe('list')
  })
})

describe('runTool — non-destructive paths', () => {
  it('createTask writes a row scoped to the user', async () => {
    const session = await signUp()
    const out = await runTool({
      userId: session.userId,
      name: 'createTask',
      args: {
        title: 'Renew car insurance',
        domain: 'car',
        dueAt: '2026-06-01T09:00:00+03:00',
      },
      timezone: 'Africa/Cairo',
    })
    expect((out.result.task as { title: string }).title).toBe('Renew car insurance')
    const persisted = await Task.findOne({ userId: session.userId })
    expect(persisted?.title).toBe('Renew car insurance')
  })

  it('completeTask flips status to done', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'x',
      domain: 'home',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'completeTask',
      args: { taskId: task.id },
    })
    expect((out.result.task as { status: string }).status).toBe('done')
  })

  it('runs updateTask inline — a missing task 404s rather than gating on confirmation', async () => {
    const session = await signUp()
    await expect(
      runTool({
        userId: session.userId,
        name: 'updateTask',
        args: { taskId: new Types.ObjectId().toHexString(), title: 'x' },
      }),
    ).rejects.toMatchObject({ code: 'task_not_found' })
  })

  it('queryTasks returns only the caller’s tasks', async () => {
    const a = await signUp()
    const b = await signUp()
    await Task.create({ userId: a.userId, title: 'A1', domain: 'home', status: 'open' })
    await Task.create({ userId: b.userId, title: 'B1', domain: 'home', status: 'open' })
    const out = await runTool({
      userId: a.userId,
      name: 'queryTasks',
      args: { status: 'open' },
    })
    const titles = (out.result.tasks as Array<{ title: string }>).map((t) => t.title)
    expect(titles).toEqual(['A1'])
  })
})

describe('time estimates through the chat agent', () => {
  it('createTask snaps the agent’s bounds onto the bucket ladder', async () => {
    const session = await signUp()
    await runTool({
      userId: session.userId,
      name: 'createTask',
      args: {
        title: 'Sort the recycling',
        domain: 'home',
        kind: 'list',
        // 23 is not a bucket, and the agent sending it must not cost the create.
        estimateMinMinutes: '23',
        estimateMaxMinutes: 47,
      },
    })
    const persisted = await Task.findOne({ userId: session.userId })
    expect(persisted?.estimate?.minMinutes).toBe(30)
    expect(persisted?.estimate?.maxMinutes).toBe(45)
    expect(persisted?.estimate?.source).toBe('ai')
  })

  it('createTask leaves the estimate absent when the agent gave none', async () => {
    const session = await signUp()
    await runTool({
      userId: session.userId,
      name: 'createTask',
      args: { title: 'Buy bread', domain: 'home', kind: 'list' },
    })
    const persisted = await Task.findOne({ userId: session.userId })
    expect(persisted?.estimate).toBeUndefined()
  })

  it('updateTask fills in a first estimate on a task that had none', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'Deep clean the oven',
      domain: 'home',
      status: 'open',
    })
    await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, estimateMinMinutes: '60', estimateMaxMinutes: '90' },
    })
    const persisted = await Task.findById(task.id)
    expect(persisted?.estimate).toMatchObject({ minMinutes: 60, maxMinutes: 90, source: 'ai' })
  })

  it('a user-set estimate survives an AI pass that tries to change it', async () => {
    // The contract's hardest rule: once the person has said how long something
    // takes them, the agent does not get to disagree. Everything else in the
    // same call must still apply, so this is not "reject the update".
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'File the tax return',
      domain: 'finance',
      status: 'open',
      estimate: { minMinutes: 120, maxMinutes: 180, source: 'user' },
    })

    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: {
        taskId: task.id,
        title: 'File the 2026 tax return',
        estimateMinMinutes: '5',
        estimateMaxMinutes: '10',
      },
    })

    const persisted = await Task.findById(task.id)
    expect(persisted?.estimate).toMatchObject({
      minMinutes: 120,
      maxMinutes: 180,
      source: 'user',
    })
    // The rest of the update still landed.
    expect(persisted?.title).toBe('File the 2026 tax return')
    expect((out.result.task as { title: string }).title).toBe('File the 2026 tax return')
  })

  it('an estimate-only update returns the task rather than erroring on an empty mutation', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'Water the plants',
      domain: 'home',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, estimateMinMinutes: '5', estimateMaxMinutes: '5' },
    })
    expect((out.result.task as { estimate?: { minMinutes: number } }).estimate?.minMinutes).toBe(5)
  })
})

describe('mutation tool paths — inline edits + the bulk-delete guard', () => {
  it('updateTask runs inline (no confirmation)', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'old',
      domain: 'home',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, title: 'new' },
    })
    expect((out.result.task as { title: string }).title).toBe('new')
  })

  it('updateTask writes notes when provided', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'renew car insurance',
      domain: 'car',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: {
        taskId: task.id,
        notes: 'Bring: ID, current policy, registration. Office on 5th Ave.',
      },
    })
    expect((out.result.task as { notes: string }).notes).toMatch(/^Bring: ID/)
  })

  it('updateTask clears notes when given empty string', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'with notes',
      domain: 'home',
      status: 'open',
      notes: 'previous notes',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, notes: '' },
    })
    expect((out.result.task as { notes?: string }).notes ?? null).toBeNull()
  })

  it('updateTask clears notes when given null', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'with notes',
      domain: 'home',
      status: 'open',
      notes: 'previous notes',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, notes: null },
    })
    expect((out.result.task as { notes?: string }).notes ?? null).toBeNull()
  })

  it('updateTask leaves notes untouched when omitted', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'with notes',
      domain: 'home',
      status: 'open',
      notes: 'should survive',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, title: 'renamed' },
    })
    expect((out.result.task as { notes: string }).notes).toBe('should survive')
  })

  it('deleteTask actually deletes', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'gone',
      domain: 'home',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'deleteTask',
      args: { taskId: task.id },
    })
    expect(out.result.deleted).toBe(true)
    // Soft delete — the row survives so the delete stays undoable, but it must
    // be invisible to every live read.
    expect(out.result.undoToken).toBeTruthy()
    expect((await Task.findById(task.id))?.deletedAt).toBeInstanceOf(Date)
    expect(await Task.countDocuments({ userId: session.userId, ...notDeleted() })).toBe(0)
  })

  it('deleteAllTasks requires confirmation (never runs inline)', async () => {
    const session = await signUp()
    await expect(
      runTool({ userId: session.userId, name: 'deleteAllTasks', args: {} }),
    ).rejects.toMatchObject({ code: 'tool_requires_confirmation' })
  })

  it('deleteAllTasks wipes every task for the user after confirmation', async () => {
    const session = await signUp()
    const other = await signUp()
    await Task.create([
      { userId: session.userId, title: 'a', domain: 'home', status: 'open' },
      { userId: session.userId, title: 'b', domain: 'finance', status: 'done' },
      { userId: session.userId, title: 'c', domain: 'car', status: 'snoozed' },
      // A different user's task must survive.
      { userId: other.userId, title: 'theirs', domain: 'home', status: 'open' },
    ])
    const out = await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: {},
    })
    expect(out.result.deleted).toBe(true)
    expect(out.result.deletedCount).toBe(3)
    expect(await Task.countDocuments({ userId: session.userId, ...notDeleted() })).toBe(0)
    expect(await Task.countDocuments({ userId: other.userId, ...notDeleted() })).toBe(1)
  })

  it('deleteAllTasks honors a status filter (clear completed only)', async () => {
    const session = await signUp()
    await Task.create([
      { userId: session.userId, title: 'open one', domain: 'home', status: 'open' },
      { userId: session.userId, title: 'done one', domain: 'home', status: 'done' },
      { userId: session.userId, title: 'done two', domain: 'finance', status: 'done' },
    ])
    const out = await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { status: 'done' },
    })
    expect(out.result.deletedCount).toBe(2)
    const remaining = await Task.find({ userId: session.userId, ...notDeleted() })
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe('open')
  })

  it('deleteAllTasks on an empty list is a no-op success (count 0)', async () => {
    const session = await signUp()
    const out = await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: {},
    })
    expect(out.result.deleted).toBe(true)
    expect(out.result.deletedCount).toBe(0)
  })

  it('countTasksForBulkDelete counts matching tasks for the confirmation card', async () => {
    const session = await signUp()
    await Task.create([
      { userId: session.userId, title: 'x', domain: 'finance', status: 'open' },
      { userId: session.userId, title: 'y', domain: 'finance', status: 'done' },
      { userId: session.userId, title: 'z', domain: 'home', status: 'open' },
    ])
    expect(await countTasksForBulkDelete(session.userId, {})).toBe(3)
    expect(await countTasksForBulkDelete(session.userId, { domain: 'finance' })).toBe(2)
    // Unparseable args fall back to null so the card shows a generic label.
    expect(await countTasksForBulkDelete(session.userId, { domain: 'spaceship' })).toBeNull()
  })

  it('refuses to run non-destructive createTask via runConfirmedTool', async () => {
    const session = await signUp()
    await expect(
      runConfirmedTool({
        userId: session.userId,
        name: 'createTask',
        args: { title: 'x', domain: 'home' },
      }),
    ).rejects.toMatchObject({ code: 'tool_not_destructive' })
  })

  it('updateTask sets priority', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'urgent thing',
      domain: 'home',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, priority: 'urgent' },
    })
    expect((out.result.task as { priority: string }).priority).toBe('urgent')
  })

  it('updateTask replaces tags (full replace, normalized)', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'tagged',
      domain: 'home',
      status: 'open',
      tags: ['old-tag'],
    })
    const out = await runTool({
      userId: session.userId,
      name: 'updateTask',
      args: { taskId: task.id, tags: ['Admin Stuff', 'Q3 2026', 'admin stuff'] },
    })
    // Normalized to lowercase-kebab + de-duped.
    expect((out.result.task as { tags: string[] }).tags).toEqual(['admin-stuff', 'q3-2026'])
  })

  it('removeSubtask runs inline now — only a missing task 404s, no confirmation gate', async () => {
    const session = await signUp()
    await expect(
      runTool({
        userId: session.userId,
        name: 'removeSubtask',
        args: { taskId: '507f1f77bcf86cd799439011', subtaskId: '507f1f77bcf86cd799439012' },
      }),
    ).rejects.toMatchObject({ code: 'task_not_found' })
  })
})

describe('runTool — subtasks', () => {
  it('addSubtask appends to the task subtask list', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'renew car insurance',
      domain: 'car',
      status: 'open',
    })
    const out = await runTool({
      userId: session.userId,
      name: 'addSubtask',
      args: { taskId: task.id, text: 'gather papers' },
    })
    const subtasks = (out.result.task as { subtasks: { text: string; done: boolean }[] })
      .subtasks
    expect(subtasks).toHaveLength(1)
    expect(subtasks[0]?.text).toBe('gather papers')
    expect(subtasks[0]?.done).toBe(false)
  })

  it('toggleSubtask flips state when done is omitted', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'with subs',
      domain: 'home',
      status: 'open',
      subtasks: [{ text: 'step 1', done: false }],
    })
    const subId = String(task.subtasks[0]?._id)

    const out1 = await runTool({
      userId: session.userId,
      name: 'toggleSubtask',
      args: { taskId: task.id, subtaskId: subId },
    })
    expect((out1.result.task as { subtasks: { done: boolean }[] }).subtasks[0]?.done).toBe(true)

    const out2 = await runTool({
      userId: session.userId,
      name: 'toggleSubtask',
      args: { taskId: task.id, subtaskId: subId },
    })
    expect((out2.result.task as { subtasks: { done: boolean }[] }).subtasks[0]?.done).toBe(false)
  })

  it('removeSubtask drops the matching subtask after confirmation', async () => {
    const session = await signUp()
    const task = await Task.create({
      userId: session.userId,
      title: 'with subs',
      domain: 'home',
      status: 'open',
      subtasks: [
        { text: 'keep', done: false },
        { text: 'go', done: false },
      ],
    })
    const goId = String(task.subtasks[1]?._id)

    const out = await runTool({
      userId: session.userId,
      name: 'removeSubtask',
      args: { taskId: task.id, subtaskId: goId },
    })
    const remaining = (out.result.task as { subtasks: { text: string }[] }).subtasks
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.text).toBe('keep')
  })
})

describe('holdForClarification — non-destructive, persists a Clarification', () => {
  it('is not destructive (runs inline, no confirmation gate)', () => {
    expect(requiresConfirmation('holdForClarification')).toBe(false)
  })

  it('persists an open clarification and normalizes option dates to the tz', async () => {
    const session = await signUp()
    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Car insurance renewal',
        domain: 'car',
        priority: 'high',
        question: 'Is it the 15th or the 18th?',
        kind: 'date',
        options: [
          { label: 'The 15th', dueAt: '2026-06-15T09:00:00+03:00' },
          { label: 'The 18th', dueAt: '2026-06-18T09:00:00+03:00' },
        ],
      },
      timezone: 'Africa/Cairo',
    })

    expect(out.result.ok).toBe(true)
    const id = out.result.clarificationId as string
    const doc = await Clarification.findById(id)
    expect(doc?.status).toBe('open')
    expect(String(doc?.userId)).toBe(session.userId)
    expect(doc?.options).toHaveLength(2)
    // +03:00 09:00 → 06:00Z — the same instant createTask would have stored.
    expect(doc?.options[1]?.dueAt?.toISOString()).toBe('2026-06-18T06:00:00.000Z')
  })

  // The turn's message rides in on RunArgs, NOT in the tool args — the model
  // must never get to edit, summarise, or invent what the user said.
  it('records the turn that produced the hold, without the model touching it', async () => {
    const session = await signUp()
    const said = 'Email that guy back about the quote — the one from last week.'
    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Email that guy',
        domain: 'home',
        priority: 'normal',
        question: "What's the email to that guy about?",
        kind: 'detail',
      },
      sourceText: said,
    })

    const doc = await Clarification.findById(out.result.clarificationId as string)
    expect(doc?.sourceText).toBe(said)
  })

  it('holds fine with no turn text to quote (the card just omits it)', async () => {
    const session = await signUp()
    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Car insurance renewal',
        domain: 'car',
        priority: 'normal',
        question: 'Is it the 15th or the 18th?',
        kind: 'date',
      },
    })

    const doc = await Clarification.findById(out.result.clarificationId as string)
    expect(doc?.status).toBe('open')
    expect(doc?.sourceText).toBeUndefined()
  })

  it('throws when routed through the confirm path (it is not destructive)', async () => {
    const session = await signUp()
    await expect(
      runConfirmedTool({
        userId: session.userId,
        name: 'holdForClarification',
        args: {
          title: 'x',
          domain: 'home',
          priority: 'normal',
          question: 'what?',
          kind: 'detail',
        },
      }),
    ).rejects.toThrow()
  })
})

const heldBase = (userId: string) => ({
  userId: new Types.ObjectId(userId),
  // Every question is anchored to a task now. These suites exercise the
  // blanket domain-scoped drop, which matches on draft.domain rather than
  // following the link, so a standalone id is enough here.
  taskId: new Types.ObjectId(),
  status: 'open' as const,
  question: 'when?',
  kind: 'date' as const,
  costOfWrong: 'high' as const,
  options: [],
})

// A chat-born hold carries no sourceKey, so nothing deduped it — the same fuzzy
// item could be held again every turn, forever. Past the cap the tool stops
// holding and creates the task outright: a guessed date the user can SEE and
// fix beats a question that piles up where they never look.
describe('holdForClarification — open queue cap', () => {
  async function fillQueue(userId: string, n: number) {
    await Promise.all(
      Array.from({ length: n }, (_, i) =>
        Clarification.create({
          ...heldBase(userId),
          draft: { title: `held ${i}`, domain: 'home', priority: 'normal', tags: [] },
        }),
      ),
    )
  }

  it('asks the question AND creates the task while under the cap', async () => {
    const session = await signUp()
    await fillQueue(session.userId, 3)
    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: { title: 'Renew passport', domain: 'home', question: 'When does it expire?', kind: 'date' },
    })
    expect(out.result.clarificationId).toBeTruthy()
    expect(out.result.queueFull).toBeUndefined()
    // The task is NOT withheld pending an answer — that was the whole defect.
    expect(await Task.countDocuments({ userId: session.userId })).toBe(1)
  })

  it('withholds the REMINDER, not the task, on a high-cost guess', async () => {
    const session = await signUp()
    await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Pay the rent',
        domain: 'finance',
        question: 'The 1st or the 5th?',
        kind: 'date',
        costOfWrong: 'high',
        dueAtGuess: '2026-09-01T09:00:00+03:00',
      },
      timezone: 'Africa/Cairo',
    })
    const task = await Task.findOne({ userId: session.userId })
    // Visible, dated, and silent until confirmed — we never fire on a guessed
    // rent day.
    expect(task?.kind).toBe('list')
    expect(task?.dueAt?.toISOString()).toBe('2026-09-01T06:00:00.000Z')
    expect(task?.reminders ?? []).toHaveLength(0)
  })

  it('lets a low-cost guess fire, because being wrong just means rescheduling', async () => {
    const session = await signUp()
    await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Call the bank',
        domain: 'finance',
        question: 'Morning or afternoon?',
        kind: 'date',
        costOfWrong: 'low',
        dueAtGuess: '2026-09-01T09:00:00+03:00',
      },
      timezone: 'Africa/Cairo',
    })
    const task = await Task.findOne({ userId: session.userId })
    expect(task?.kind).toBe('reminder')
  })

  it('creates the task instead of a 13th question once the queue is full', async () => {
    const session = await signUp()
    await fillQueue(session.userId, 12)

    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: {
        title: 'Renew passport',
        domain: 'home',
        question: 'When does it expire?',
        kind: 'date',
        dueAtGuess: '2026-09-01T09:00:00+03:00',
      },
      timezone: 'Africa/Cairo',
    })

    expect(out.result.queueFull).toBe(true)
    expect(out.result.clarificationId).toBeNull()
    // The queue stayed bounded, and the item is visible as a real task.
    expect(await Clarification.countDocuments({ userId: session.userId, status: 'open' })).toBe(12)
    const task = await Task.findOne({ userId: session.userId })
    expect(task?.title).toBe('Renew passport')
    // No costOfWrong given → 'high', so the date is kept but stays silent.
    expect(task?.kind).toBe('list')
    expect(task?.dueAt?.toISOString()).toBe('2026-09-01T06:00:00.000Z')
  })

  it('falls back to a dateless list item when there is no guess to keep', async () => {
    const session = await signUp()
    await fillQueue(session.userId, 12)

    await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: { title: 'Email that guy', domain: 'home', question: 'Who?', kind: 'detail' },
    })
    const task = await Task.findOne({ userId: session.userId })
    expect(task?.kind).toBe('list')
    expect(task?.dueAt).toBeFalsy()
  })
})

// The reported bug, at its root: a question outlived the thing it was about.
// Now that Clarification carries a real taskId, deleting the task cascades.
describe('deleteTask — cascades to its question', () => {
  it('drops the question when its task is deleted', async () => {
    const session = await signUp()
    const out = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: { title: 'Renew passport', domain: 'home', question: 'When does it expire?', kind: 'date' },
    })
    const clarificationId = out.result.clarificationId as string
    const task = await Task.findOne({ userId: session.userId })

    await runTool({
      userId: session.userId,
      name: 'deleteTask',
      args: { taskId: String(task?._id) },
    })

    const after = await Clarification.findById(clarificationId)
    expect(after?.status).toBe('dropped')
  })

  it('leaves questions about OTHER tasks open', async () => {
    const session = await signUp()
    const keep = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: { title: 'Renew passport', domain: 'home', question: 'When?', kind: 'date' },
    })
    const doomed = await runTool({
      userId: session.userId,
      name: 'holdForClarification',
      args: { title: 'Book the vet', domain: 'pets', question: 'Which day?', kind: 'date' },
    })

    const doomedTask = await Task.findOne({ userId: session.userId, title: 'Book the vet' })
    await runTool({
      userId: session.userId,
      name: 'deleteTask',
      args: { taskId: String(doomedTask?._id) },
    })

    expect((await Clarification.findById(keep.result.clarificationId as string))?.status).toBe('open')
    expect((await Clarification.findById(doomed.result.clarificationId as string))?.status).toBe(
      'dropped',
    )
  })
})

// "I delete all my tasks and the Questions for you are still there." The
// blanket wipe path, which matches on draft.domain rather than following each
// link, so a domain-scoped clear also clears its questions.
describe('deleteAllTasks — held questions', () => {

  it('drops open clarifications alongside an unfiltered wipe', async () => {
    const session = await signUp()
    await Task.create({ userId: session.userId, title: 'a', domain: 'home', status: 'open' })
    await Clarification.create({
      ...heldBase(session.userId),
      draft: { title: 'Car insurance', domain: 'car', priority: 'normal', tags: [] },
    })

    const out = await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: {},
    })
    expect(out.result.droppedQuestionCount).toBe(1)
    expect(await Clarification.countDocuments({ userId: session.userId, status: 'open' })).toBe(0)
  })

  it("leaves another user's questions alone", async () => {
    const session = await signUp()
    const other = await signUp()
    await Clarification.create({
      ...heldBase(other.userId),
      draft: { title: 'Theirs', domain: 'home', priority: 'normal', tags: [] },
    })

    await runConfirmedTool({ userId: session.userId, name: 'deleteAllTasks', args: {} })
    expect(await Clarification.countDocuments({ userId: other.userId, status: 'open' })).toBe(1)
  })

  it('scopes the drop to the wiped domain', async () => {
    const session = await signUp()
    await Clarification.create({
      ...heldBase(session.userId),
      draft: { title: 'Car thing', domain: 'car', priority: 'normal', tags: [] },
    })
    await Clarification.create({
      ...heldBase(session.userId),
      draft: { title: 'Home thing', domain: 'home', priority: 'normal', tags: [] },
    })

    await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { domain: 'car' },
    })
    const left = await Clarification.find({ userId: session.userId, status: 'open' })
    expect(left).toHaveLength(1)
    expect(left[0]?.draft.domain).toBe('home')
  })

  it('leaves questions untouched for a status-scoped wipe', async () => {
    const session = await signUp()
    await Clarification.create({
      ...heldBase(session.userId),
      draft: { title: 'Still open', domain: 'home', priority: 'normal', tags: [] },
    })

    const out = await runConfirmedTool({
      userId: session.userId,
      name: 'deleteAllTasks',
      args: { status: 'done' },
    })
    expect(out.result.droppedQuestionCount).toBe(0)
    expect(await Clarification.countDocuments({ userId: session.userId, status: 'open' })).toBe(1)
  })
})
