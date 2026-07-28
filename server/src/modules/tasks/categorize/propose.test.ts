import { Types } from 'mongoose'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

import { Task } from '../../../models/Task'
import { TaskBulkOp } from '../../../models/TaskBulkOp'
import { proposeCategorization } from './propose'

const generateContent = vi.fn()

vi.mock('../../ai/provider/geminiClient', () => ({
  isAiConfigured: () => true,
  getGeminiClient: () => ({
    models: { generateContent: (...args: unknown[]) => generateContent(...(args as [])) },
  }),
  __resetGeminiClientForTests: () => {},
}))

let userId: string

beforeEach(() => {
  userId = new Types.ObjectId().toHexString()
})

afterEach(() => {
  generateContent.mockReset()
})

function answer(items: unknown[]): void {
  generateContent.mockResolvedValue({ text: JSON.stringify({ items }) })
}

async function makeTask(
  userId: string,
  over: Partial<{ title: string; domain: string; tags: string[] }> = {},
) {
  return Task.create({
    userId,
    title: over.title ?? 'Pay the vet bill',
    domain: over.domain ?? 'finance',
    kind: 'list',
    status: 'open',
    priority: 'normal',
    tags: over.tags ?? [],
  })
}

describe('proposeCategorization', () => {
  it('proposes a domain move and records the prior value for undo', async () => {
    const task = await makeTask(userId)
    answer([
      {
        taskId: String(task._id),
        domain: 'pets',
        confidence: 'high',
        reason: 'It is about the cat',
        tags: '',
      },
    ])

    const result = await proposeCategorization({
      userId,
      target: { ids: [String(task._id)] },
    })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      fromDomain: 'finance',
      toDomain: 'pets',
      confidence: 'high',
    })

    // Nothing is written to the task itself until the proposal is applied.
    const untouched = await Task.findById(task._id)
    expect(untouched?.domain).toBe('finance')

    const op = await TaskBulkOp.findById(result.opId)
    expect(op?.status).toBe('proposed')
    expect(op?.entries[0]?.prior).toEqual({ domain: 'finance' })
    expect(op?.entries[0]?.next).toEqual({ domain: 'pets' })
  })

  it('drops rows where the model agrees and suggests no tags', async () => {
    const task = await makeTask(userId, { domain: 'pets' })
    answer([
      { taskId: String(task._id), domain: 'pets', confidence: 'high', reason: 'ok', tags: '' },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })

    expect(result.changes).toHaveLength(0)
    expect(result.unchanged).toBe(1)
    // No op is written, so the one-open-proposal slot stays free.
    expect(result.opId).toBe('')
    expect(await TaskBulkOp.countDocuments({ userId })).toBe(0)
  })

  it('adds tags without ever removing existing ones', async () => {
    const task = await makeTask(userId, { domain: 'pets', tags: ['basbousa'] })
    answer([
      {
        taskId: String(task._id),
        domain: 'pets',
        confidence: 'medium',
        reason: 'vet paperwork',
        tags: 'vet, basbousa',
      },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })

    // 'basbousa' is already there, so only 'vet' is an addition.
    expect(result.changes[0]?.addedTags).toEqual(['vet'])
    const op = await TaskBulkOp.findById(result.opId)
    expect(op?.entries[0]?.prior).toEqual({ tags: ['basbousa'] })
    expect(op?.entries[0]?.next).toEqual({ tags: ['basbousa', 'vet'] })
  })

  it('normalises proposed tags', async () => {
    const task = await makeTask(userId, { domain: 'pets' })
    answer([
      {
        taskId: String(task._id),
        domain: 'pets',
        confidence: 'low',
        reason: 'r',
        tags: '  Vet Visit  ',
      },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })
    expect(result.changes[0]?.addedTags).toEqual(['vet-visit'])
  })

  it('ignores ids the model was never given', async () => {
    const task = await makeTask(userId)
    const foreign = await Task.create({
      userId: new Types.ObjectId().toHexString(),
      title: 'Someone else’s matter',
      domain: 'home',
      kind: 'list',
      status: 'open',
      priority: 'normal',
    })

    answer([
      { taskId: String(foreign._id), domain: 'pets', confidence: 'high', reason: 'x', tags: '' },
      { taskId: String(task._id), domain: 'pets', confidence: 'high', reason: 'y', tags: '' },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })

    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]?.taskId).toBe(String(task._id))
  })

  it('falls back to low confidence when the model returns a bad bucket', async () => {
    const task = await makeTask(userId)
    answer([
      { taskId: String(task._id), domain: 'pets', confidence: 'certain', reason: 'x', tags: '' },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })
    expect(result.changes[0]?.confidence).toBe('low')
  })

  it('rejects an unknown domain rather than writing it', async () => {
    const task = await makeTask(userId)
    answer([
      { taskId: String(task._id), domain: 'groceries', confidence: 'high', reason: 'x', tags: '' },
    ])

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })
    expect(result.changes).toHaveLength(0)
  })

  it('reports nothing rather than throwing when the model fails', async () => {
    const task = await makeTask(userId)
    generateContent.mockRejectedValue(new Error('upstream is down'))

    const result = await proposeCategorization({ userId, target: { ids: [String(task._id)] } })
    expect(result.changes).toHaveLength(0)
  })
})
