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
