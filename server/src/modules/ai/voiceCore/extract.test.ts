// Key must exist before the cached env() first read (extract -> getGeminiClient).
process.env.GEMINI_API_KEY = 'test-key'

import { describe, expect, it, vi, beforeEach } from 'vitest'

import { __resetEnvForTests } from '../../../env'
import { __resetGeminiClientForTests } from '../provider/geminiClient'

// Mock the SDK at the module boundary. Structured-output path: the extractor
// reads response.text as a JSON string (NOT function calls). The Type enum must
// include ARRAY/OBJECT/STRING because extract.ts builds responseSchema at load.
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

// The stub strings that must NEVER appear in real output again.
const PLACEHOLDER_DENYLIST = [
  'Pipeline placeholder',
  'replace with Gemini',
  'Review what you just said',
  'Placeholder task',
]

function modelResponse(tasks: unknown[]): { text: string } {
  return { text: JSON.stringify({ tasks }) }
}

interface TaskFixture {
  title: string
  domain: string
  confidence: string
  reviewReason: string
  priority?: string
  dueRaw?: string | null
  dueAt?: string | null
  reasons?: string[]
  notes?: string | null
}

function task(partial: Partial<TaskFixture> & { title: string; domain: string }): TaskFixture {
  return {
    confidence: 'high',
    reviewReason: 'clear',
    priority: 'normal',
    dueRaw: null,
    dueAt: null,
    reasons: [],
    notes: null,
    ...partial,
  }
}

beforeEach(() => {
  __resetEnvForTests()
  __resetGeminiClientForTests()
  generateContentMock.mockReset()
})

describe('extractItems', () => {
  it('returns [] for an empty transcript without calling the model', async () => {
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: '   ' })
    expect(items).toEqual([])
    expect(generateContentMock).not.toHaveBeenCalled()
  })

  it('parses a confident single task and resolves its due date', async () => {
    generateContentMock.mockResolvedValueOnce(
      modelResponse([
        task({
          title: 'Renew car insurance',
          domain: 'car',
          dueRaw: 'before the 15th',
          dueAt: '2026-06-15T09:00:00+03:00',
        }),
      ]),
    )
    const { extractItems } = await import('./extract')
    const items = await extractItems({
      transcript: 'renew my car insurance before the 15th',
      timezone: 'Africa/Cairo',
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.title).toBe('Renew car insurance')
    expect(items[0]?.domain).toBe('car')
    expect(items[0]?.confidence).toBe('high')
    expect(items[0]?.reviewReason).toBe('clear')
    expect(items[0]?.dueAt?.toISOString()).toBe('2026-06-15T06:00:00.000Z')
  })

  it('extracts a 20-intent monster note into 20 keyed-ready drafts', async () => {
    const domains = ['health', 'home', 'car', 'finance', 'family', 'pets']
    const fixtures = Array.from({ length: 20 }, (_, i) =>
      task({ title: `Task number ${i + 1}`, domain: domains[i % domains.length]! }),
    )
    generateContentMock.mockResolvedValueOnce(modelResponse(fixtures))
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: 'a very long brain dump', timezone: 'Africa/Cairo' })
    expect(items).toHaveLength(20)
    expect(items.map((i) => i.title)).toEqual(fixtures.map((f) => f.title))
    for (const item of items) {
      expect(domains).toContain(item.domain)
      expect(item.title.length).toBeLessThanOrEqual(240)
    }
  })

  it('holds an unknown-domain task instead of dropping it', async () => {
    generateContentMock.mockResolvedValueOnce(
      modelResponse([task({ title: 'Do the thing', domain: 'spaceship' })]),
    )
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: 'do the thing' })
    expect(items).toHaveLength(1) // NOT dropped
    expect(items[0]?.domain).toBe('home')
    expect(items[0]?.reviewReason).toBe('unknown_domain')
    expect(items[0]?.confidence).toBe('low')
  })

  it('flags vague_date when a time was named but did not resolve', async () => {
    generateContentMock.mockResolvedValueOnce(
      modelResponse([
        task({ title: 'Call the plumber', domain: 'home', dueRaw: 'sometime soon', dueAt: null }),
      ]),
    )
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: 'call the plumber sometime soon' })
    expect(items[0]?.dueAt).toBeUndefined()
    expect(items[0]?.reviewReason).toBe('vague_date')
    expect(items[0]?.confidence).toBe('medium')
  })

  it('collapses an exact duplicate intent into one task', async () => {
    generateContentMock.mockResolvedValueOnce(
      modelResponse([
        task({ title: 'Pay water bill', domain: 'finance' }),
        task({ title: 'Pay water bill', domain: 'finance' }),
      ]),
    )
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: 'pay water bill, the water bill' })
    expect(items).toHaveLength(1)
  })

  it('never emits a placeholder/stub task', async () => {
    generateContentMock.mockResolvedValueOnce(
      modelResponse([task({ title: 'Book dentist cleaning', domain: 'health' })]),
    )
    const { extractItems } = await import('./extract')
    const items = await extractItems({ transcript: 'book a dentist cleaning' })
    for (const item of items) {
      for (const banned of PLACEHOLDER_DENYLIST) {
        expect(item.title).not.toContain(banned)
      }
    }
  })
})
