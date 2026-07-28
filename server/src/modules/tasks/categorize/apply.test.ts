import { Types } from 'mongoose'
import { beforeEach, describe, expect, it } from 'vitest'

import { Task } from '../../../models/Task'
import { TaskBulkOp, bulkOpExpiry } from '../../../models/TaskBulkOp'
import { undoBulk } from '../bulkService'
import { applyProposal, discardProposal, getPendingProposal } from './apply'

let userId: string

beforeEach(() => {
  userId = new Types.ObjectId().toHexString()
})

async function seedProposal(
  userId: string,
  specs: { title: string; domain: string; tags?: string[]; toDomain: string; addTags?: string[] }[],
) {
  const tasks = await Promise.all(
    specs.map((s) =>
      Task.create({
        userId,
        title: s.title,
        domain: s.domain,
        kind: 'list',
        status: 'open',
        priority: 'normal',
        tags: s.tags ?? [],
      }),
    ),
  )

  const op = await TaskBulkOp.create({
    userId,
    kind: 'categorize',
    action: 'categorize',
    status: 'proposed',
    entries: tasks.map((task, i) => {
      const spec = specs[i]!
      const prior: Record<string, unknown> = { domain: task.domain }
      const next: Record<string, unknown> = { domain: spec.toDomain }
      if (spec.addTags) {
        prior.tags = [...task.tags]
        next.tags = [...task.tags, ...spec.addTags]
      }
      return { taskId: task._id, prior, next, confidence: 'high', reason: 'because' }
    }),
    expiresAt: bulkOpExpiry(),
  })

  return { tasks, op }
}

describe('applyProposal', () => {
  it('writes only the accepted rows and leaves the rest alone', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
      { title: 'Oil change', domain: 'home', toDomain: 'car' },
    ])

    const result = await applyProposal(userId, String(op._id), [String(tasks[0]!._id)])

    expect(result.applied).toBe(1)
    expect((await Task.findById(tasks[0]!._id))?.domain).toBe('pets')
    // The rejected row keeps the domain it had.
    expect((await Task.findById(tasks[1]!._id))?.domain).toBe('home')
  })

  it('narrows the op to the accepted rows so undo cannot touch a rejected one', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
      { title: 'Oil change', domain: 'home', toDomain: 'car' },
    ])

    await applyProposal(userId, String(op._id), [String(tasks[0]!._id)])

    const saved = await TaskBulkOp.findById(op._id)
    expect(saved?.entries).toHaveLength(1)
    expect(String(saved?.entries[0]?.taskId)).toBe(String(tasks[0]!._id))
  })

  it('round-trips through the shared undo', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', tags: ['bills'], toDomain: 'pets', addTags: ['vet'] },
    ])

    const result = await applyProposal(userId, String(op._id), [String(tasks[0]!._id)])
    const applied = await Task.findById(tasks[0]!._id)
    expect(applied?.domain).toBe('pets')
    expect(applied?.tags).toEqual(['bills', 'vet'])

    await undoBulk(userId, result.undoToken!)

    const restored = await Task.findById(tasks[0]!._id)
    expect(restored?.domain).toBe('finance')
    expect(restored?.tags).toEqual(['bills'])
  })

  it('discards rather than applying when nothing is accepted', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
    ])

    const result = await applyProposal(userId, String(op._id), [])

    expect(result.applied).toBe(0)
    expect(result.undoToken).toBeNull()
    expect((await TaskBulkOp.findById(op._id))?.status).toBe('discarded')
    expect((await Task.findById(tasks[0]!._id))?.domain).toBe('finance')
  })

  it('refuses to apply the same proposal twice', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
    ])
    await applyProposal(userId, String(op._id), [String(tasks[0]!._id)])

    await expect(
      applyProposal(userId, String(op._id), [String(tasks[0]!._id)]),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('will not touch another user’s proposal', async () => {
    const { tasks, op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
    ])
    const stranger = new Types.ObjectId().toHexString()

    await expect(
      applyProposal(stranger, String(op._id), [String(tasks[0]!._id)]),
    ).rejects.toMatchObject({ status: 404 })
    expect((await Task.findById(tasks[0]!._id))?.domain).toBe('finance')
  })
})

describe('getPendingProposal', () => {
  it('joins titles back on and computes the added tags', async () => {
    await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', tags: ['bills'], toDomain: 'pets', addTags: ['vet'] },
    ])

    const pending = await getPendingProposal(userId)

    expect(pending?.changes).toHaveLength(1)
    expect(pending?.changes[0]).toMatchObject({
      title: 'Vet bill',
      fromDomain: 'finance',
      toDomain: 'pets',
      addedTags: ['vet'],
    })
  })

  it('drops rows whose matter was trashed while the proposal waited', async () => {
    const { tasks } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
    ])
    await Task.updateOne({ _id: tasks[0]!._id }, { $set: { deletedAt: new Date() } })

    const pending = await getPendingProposal(userId)
    expect(pending?.changes).toHaveLength(0)
  })

  it('returns null once discarded', async () => {
    const { op } = await seedProposal(userId, [
      { title: 'Vet bill', domain: 'finance', toDomain: 'pets' },
    ])
    await discardProposal(userId, String(op._id))
    expect(await getPendingProposal(userId)).toBeNull()
  })
})
