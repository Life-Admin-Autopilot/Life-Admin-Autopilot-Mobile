// Key must exist before the cached env() first read (estimateBacklog -> getGeminiClient).
process.env.GEMINI_API_KEY = 'test-key'

import { Types } from 'mongoose'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { __resetEnvForTests } from '../../env'
import { __resetGeminiClientForTests } from '../ai/provider/geminiClient'
import { Task } from '../../models/Task'

const generateContentMock = vi.fn()

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: generateContentMock }
    constructor(_args: unknown) {
      void _args
    }
  }
  const Type = {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    INTEGER: 'INTEGER',
    BOOLEAN: 'BOOLEAN',
  }
  return { GoogleGenAI, Type }
})

function modelResponse(estimates: unknown[]): { text: string } {
  return { text: JSON.stringify({ estimates }) }
}

beforeEach(() => {
  __resetEnvForTests()
  __resetGeminiClientForTests()
  generateContentMock.mockReset()
})

const userId = new Types.ObjectId()

function openTask(title: string, extra: Record<string, unknown> = {}) {
  return Task.create({ userId, title, domain: 'home', status: 'open', ...extra })
}

describe('estimateBacklog', () => {
  it('fills in estimates for matters that predate the feature', async () => {
    const task = await openTask('Deep clean the oven')
    generateContentMock.mockResolvedValueOnce(
      modelResponse([{ taskId: String(task._id), minMinutes: '60', maxMinutes: '90' }]),
    )

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId })

    expect(result).toEqual({ estimated: 1, remaining: 0 })
    const persisted = await Task.findById(task._id)
    expect(persisted?.estimate).toMatchObject({ minMinutes: 60, maxMinutes: 90, source: 'ai' })
  })

  it('never sees a task the user already estimated by hand', async () => {
    // The backfill's version of "source: user wins forever" — the guarded task
    // is not in the query at all, so it cannot be sent to the model or written.
    const userSet = await openTask('File the tax return', {
      estimate: { minMinutes: 120, maxMinutes: 180, source: 'user' },
    })
    const blank = await openTask('Water the plants')

    generateContentMock.mockResolvedValueOnce(
      modelResponse([{ taskId: String(blank._id), minMinutes: '5', maxMinutes: '5' }]),
    )

    const { estimateBacklog } = await import('./estimateBacklog')
    await estimateBacklog({ userId })

    const prompt = JSON.stringify(generateContentMock.mock.calls[0]?.[0] ?? {})
    expect(prompt).not.toContain(String(userSet._id))
    expect(prompt).toContain(String(blank._id))

    const persisted = await Task.findById(userSet._id)
    expect(persisted?.estimate).toMatchObject({
      minMinutes: 120,
      maxMinutes: 180,
      source: 'user',
    })
  })

  it('leaves an existing AI estimate alone too, so a re-run is not a re-guess', async () => {
    await openTask('Renew the parking permit', {
      estimate: { minMinutes: 15, maxMinutes: 30, source: 'ai' },
    })

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId })

    expect(result).toEqual({ estimated: 0, remaining: 0 })
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('drops an id the model invented instead of writing it onto a real matter', async () => {
    const task = await openTask('Book the vet')
    generateContentMock.mockResolvedValueOnce(
      modelResponse([
        { taskId: new Types.ObjectId().toHexString(), minMinutes: '30', maxMinutes: '45' },
        { taskId: String(task._id), minMinutes: '5', maxMinutes: '10' },
      ]),
    )

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId })

    expect(result.estimated).toBe(1)
    const persisted = await Task.findById(task._id)
    expect(persisted?.estimate).toMatchObject({ minMinutes: 5, maxMinutes: 10 })
  })

  it('snaps an off-ladder answer rather than skipping the task', async () => {
    const task = await openTask('Sort the recycling')
    generateContentMock.mockResolvedValueOnce(
      modelResponse([{ taskId: String(task._id), minMinutes: 23, maxMinutes: 47 }]),
    )

    const { estimateBacklog } = await import('./estimateBacklog')
    await estimateBacklog({ userId })

    const persisted = await Task.findById(task._id)
    expect(persisted?.estimate).toMatchObject({ minMinutes: 30, maxMinutes: 45, source: 'ai' })
  })

  it('reports zero and leaves the backlog intact when the model fails', async () => {
    const task = await openTask('Call the plumber')
    generateContentMock.mockRejectedValue(new Error('boom'))

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId })

    // A backfill is an improvement, never a thing worth failing a request over.
    expect(result).toEqual({ estimated: 0, remaining: 1 })
    const persisted = await Task.findById(task._id)
    expect(persisted?.estimate).toBeUndefined()
  })

  it('skips completed matters — nobody plans time for finished work', async () => {
    await openTask('Already handled', { status: 'done', completedAt: new Date() })

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId })

    expect(result).toEqual({ estimated: 0, remaining: 0 })
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('reports what is left so the caller knows to run again', async () => {
    // Dated so the nearest-first sort is deterministic — a batch takes the work
    // closest to due, which is the work most likely to be looked at.
    const soonest = await openTask('One', { dueAt: new Date('2026-01-01T09:00:00Z') })
    await openTask('Two', { dueAt: new Date('2026-06-01T09:00:00Z') })
    generateContentMock.mockResolvedValueOnce(
      modelResponse([{ taskId: String(soonest._id), minMinutes: '5', maxMinutes: '5' }]),
    )

    const { estimateBacklog } = await import('./estimateBacklog')
    const result = await estimateBacklog({ userId, limit: 1 })

    expect(result.estimated).toBe(1)
    expect(result.remaining).toBe(1)
  })
})
