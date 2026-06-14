// Key before any cached env() read (extract -> getGeminiClient).
process.env.GEMINI_API_KEY = 'test-key'

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Types } from 'mongoose'

// transcribeAudio is mocked module-wide so no audio/Gemini round-trip happens;
// the extractor's Gemini call is mocked via @google/genai below.
const transcribeMock = vi.fn()
vi.mock('../modules/ai/audioTranscriber', () => ({
  transcribeAudio: (...args: unknown[]) => transcribeMock(...args),
}))

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

vi.mock('./voiceNoteStorage', () => ({
  getVoiceNoteStorage: () => ({
    get: async () => Buffer.from([0x00, 0x01, 0x02]),
    put: async () => {},
    remove: async () => {},
  }),
  buildStorageKey: (u: string, n: string) => `${u}/${n}.m4a`,
}))

import { VoiceNote, type VoiceNoteDoc } from '../models/VoiceNote'
import { Task } from '../models/Task'
import { Clarification } from '../models/Clarification'
import { processVoiceNote } from './voiceNoteTranscriber'
import { __resetEnvForTests } from '../env'
import { __resetGeminiClientForTests } from '../modules/ai/provider/geminiClient'

const PLACEHOLDER_DENYLIST = [
  'Pipeline placeholder',
  'replace with Gemini',
  'Review what you just said',
  'Placeholder task',
]

interface TaskFixture {
  title: string
  domain: string
  confidence: string
  reviewReason: string
  priority: string
  dueRaw: string | null
  dueAt: string | null
  reasons: string[]
  notes: string | null
  // The "ask, don't guess" block — present only on clarifiable fixtures.
  clarifyQuestion?: string
  clarifyKind?: string
  clarifyOptions?: { label: string; dueAt?: string }[]
}

function task(p: Partial<TaskFixture> & { title: string; domain: string }): TaskFixture {
  return {
    confidence: 'high',
    reviewReason: 'clear',
    priority: 'normal',
    dueRaw: null,
    dueAt: null,
    reasons: [],
    notes: null,
    ...p,
  }
}

function extractResponse(tasks: TaskFixture[]): { text: string } {
  return { text: JSON.stringify({ tasks }) }
}

async function makeNote(overrides: Record<string, unknown> = {}): Promise<VoiceNoteDoc> {
  return VoiceNote.create({
    userId: new Types.ObjectId(),
    storageKey: 'user/note.m4a',
    durationMs: 5000,
    byteSize: 12,
    source: 'app',
    status: 'pending',
    clientCapturedAt: new Date(),
    timezone: 'Africa/Cairo',
    ...overrides,
  })
}

beforeEach(() => {
  // env may have been cached by an earlier test file without GEMINI_API_KEY —
  // reset so getGeminiClient() sees the key set at the top of this file.
  __resetEnvForTests()
  __resetGeminiClientForTests()
  transcribeMock.mockReset()
  generateContentMock.mockReset()
})

describe('processVoiceNote', () => {
  it('auto-saves all-confident tasks and reaches ready (no review held)', async () => {
    transcribeMock.mockResolvedValueOnce('renew insurance and pay the water bill')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({ title: 'Renew car insurance', domain: 'car' }),
        task({ title: 'Pay water bill', domain: 'finance' }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    expect(fresh?.status).toBe('ready')
    expect(fresh?.extractedTasks).toHaveLength(2)
    expect(fresh?.reviewItems).toHaveLength(0)

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(2)
    expect(tasks.every((t) => t.confidence === 'high')).toBe(true)
    // back-link populated
    expect(fresh?.extractedTasks.every((e) => e.taskId)).toBe(true)
  })

  it('holds uncertain tasks for review and reaches needs_review', async () => {
    transcribeMock.mockResolvedValueOnce('a couple things, one is fuzzy')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({ title: 'Book dentist cleaning', domain: 'health' }),
        task({
          title: 'Maybe call someone about the thing',
          domain: 'home',
          confidence: 'low',
          reviewReason: 'ambiguous_intent',
          reasons: ['Not sure who or what'],
        }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    expect(fresh?.status).toBe('needs_review')
    expect(fresh?.extractedTasks).toHaveLength(1)
    expect(fresh?.reviewItems).toHaveLength(1)
    expect(fresh?.reviewItems[0]?.reviewReason).toBe('ambiguous_intent')

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(1) // only the confident one persisted
  })

  it('holds a clarifiable voice item as an open Clarification, not a task or review item', async () => {
    transcribeMock.mockResolvedValueOnce('see the doctor on the 17th or 19th, not sure')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({
          title: 'See the doctor',
          domain: 'health',
          clarifyQuestion: 'The 17th or the 19th?',
          clarifyKind: 'date',
          clarifyOptions: [
            { label: 'The 17th', dueAt: '2026-06-17T09:00:00+03:00' },
            { label: 'The 19th', dueAt: '2026-06-19T09:00:00+03:00' },
          ],
        }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    // No review items → ready; the held item lives as a Clarification instead.
    expect(fresh?.status).toBe('ready')
    expect(fresh?.extractedTasks).toHaveLength(0)
    expect(fresh?.reviewItems).toHaveLength(0)
    expect(fresh?.clarifyItems).toHaveLength(1)

    // The whole point: nothing was silently created with a guessed date.
    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(0)

    const clars = await Clarification.find({ userId: note.userId })
    expect(clars).toHaveLength(1)
    expect(clars[0]?.status).toBe('open')
    expect(clars[0]?.kind).toBe('date')
    expect(clars[0]?.options).toHaveLength(2)
    expect(clars[0]?.draft.title).toBe('See the doctor')
  })

  it('upserts voice clarifications idempotently across re-processing (no duplicate question)', async () => {
    transcribeMock.mockResolvedValueOnce('renew gym membership, july or august not sure')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({
          title: 'Renew gym membership',
          domain: 'health',
          clarifyQuestion: 'July or August?',
          clarifyKind: 'date',
          clarifyOptions: [
            { label: 'July', dueAt: '2026-07-05T09:00:00+03:00' },
            { label: 'August', dueAt: '2026-08-05T09:00:00+03:00' },
          ],
        }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)
    // Recovery path (clarifyItems already staged) re-upserts the SAME hold.
    await processVoiceNote(note)

    const clars = await Clarification.find({ userId: note.userId })
    expect(clars).toHaveLength(1)
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('writes ZERO tasks for a no-speech transcript (no filler row)', async () => {
    transcribeMock.mockResolvedValueOnce('')
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    expect(fresh?.status).toBe('ready')
    expect(fresh?.extractedTasks).toHaveLength(0)
    expect(fresh?.reviewItems).toHaveLength(0)
    expect(generateContentMock).not.toHaveBeenCalled()

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(0)
  })

  it('is idempotent — re-processing never double-creates and skips re-transcription', async () => {
    transcribeMock.mockResolvedValueOnce('two clear tasks')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({ title: 'Renew car insurance', domain: 'car' }),
        task({ title: 'Pay water bill', domain: 'finance' }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)
    // Second pass uses the recovery path (extraction already stored).
    await processVoiceNote(note)

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(2)
    expect(transcribeMock).toHaveBeenCalledTimes(1)
    expect(generateContentMock).toHaveBeenCalledTimes(1)
  })

  it('backs off to pending on a transient Gemini error (no terminal failure)', async () => {
    transcribeMock.mockRejectedValueOnce({ status: 503, message: 'model is overloaded' })
    const note = await makeNote()
    const before = Date.now()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    expect(fresh?.status).toBe('pending')
    expect(fresh?.lastError).toBeTruthy()
    expect(fresh?.nextRunAt.getTime()).toBeGreaterThan(before)

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(0)
  })

  it('marks failed on a non-transient error', async () => {
    transcribeMock.mockRejectedValueOnce({ status: 400, message: 'bad audio' })
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    expect(fresh?.status).toBe('failed')
    expect(fresh?.failureReason).toBeTruthy()
  })

  it('never persists a placeholder/stub task or review item', async () => {
    transcribeMock.mockResolvedValueOnce('real spoken content here')
    generateContentMock.mockResolvedValueOnce(
      extractResponse([
        task({ title: 'Schedule oil change', domain: 'car' }),
        task({ title: 'Vague errand', domain: 'home', confidence: 'low', reviewReason: 'incomplete' }),
      ]),
    )
    const note = await makeNote()
    await processVoiceNote(note)

    const fresh = await VoiceNote.findById(note.id)
    const titles = [
      ...(fresh?.extractedTasks.map((e) => e.title) ?? []),
      ...(fresh?.reviewItems.map((r) => r.title) ?? []),
    ]
    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    for (const t of tasks) titles.push(t.title)
    for (const title of titles) {
      for (const banned of PLACEHOLDER_DENYLIST) {
        expect(title).not.toContain(banned)
      }
    }
  })
})
