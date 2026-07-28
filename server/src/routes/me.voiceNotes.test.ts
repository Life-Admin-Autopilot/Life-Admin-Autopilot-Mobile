import { describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import { auth, request, signUp } from '../test/helpers'
import { getVoiceNoteStorage } from '../lib/voiceNoteStorage'
import { VoiceNote } from '../models/VoiceNote'
import { Task } from '../models/Task'
import { Clarification } from '../models/Clarification'
import type { DraftItem } from '../modules/ai/voiceCore/contract'

// Extraction seam for the manual re-extract route — the real one is a Gemini
// round. Tests push the drafts they want the gate to sort.
const extractMock = vi.fn(async (): Promise<DraftItem[]> => [])
vi.mock('../modules/ai/voiceCore/extract', () => ({
  extractItems: () => extractMock(),
}))

vi.mock('../lib/voiceNoteStorage', () => {
  const store = new Map<string, Buffer>()
  return {
    getVoiceNoteStorage: () => ({
      put: async (k: string, b: Buffer) => {
        store.set(k, b)
      },
      get: async (k: string) => {
        const v = store.get(k)
        if (!v) throw new Error('missing')
        return v
      },
      remove: async (k: string) => {
        store.delete(k)
      },
    }),
    buildStorageKey: (u: string, n: string) => `${u}/${n}.m4a`,
  }
})

describe('POST /me/voice-notes', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request.post('/me/voice-notes').send(Buffer.from([0x00]))
    expect(res.status).toBe(401)
  })

  it('rejects empty body', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/voice-notes')
      .set('Authorization', auth(session.accessToken))
      .set('Content-Type', 'audio/m4a')
      .set('x-voice-note-duration-ms', '1500')
      .set('x-voice-note-captured-at', new Date().toISOString())
      .send(Buffer.alloc(0))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('empty_body')
  })

  it('rejects missing metadata headers', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/voice-notes')
      .set('Authorization', auth(session.accessToken))
      .set('Content-Type', 'audio/m4a')
      .send(Buffer.from([0x01, 0x02, 0x03]))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_metadata')
  })

  it('accepts a valid voice note and returns 202 with pending status', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/voice-notes')
      .set('Authorization', auth(session.accessToken))
      .set('Content-Type', 'audio/m4a')
      .set('x-voice-note-duration-ms', '2000')
      .set('x-voice-note-captured-at', new Date().toISOString())
      .set('x-voice-note-source', 'widget')
      .send(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]))
    expect(res.status).toBe(202)
    expect(res.body.voiceNote.status).toBe('pending')
    expect(res.body.voiceNote.source).toBe('widget')
    expect(res.body.voiceNote.durationMs).toBe(2000)
  })
})

describe('GET /me/voice-notes/:id', () => {
  it('returns 404 for another user\'s note', async () => {
    const a = await signUp()
    const b = await signUp()

    const created = await request
      .post('/me/voice-notes')
      .set('Authorization', auth(a.accessToken))
      .set('Content-Type', 'audio/m4a')
      .set('x-voice-note-duration-ms', '1000')
      .set('x-voice-note-captured-at', new Date().toISOString())
      .send(Buffer.from([0x10, 0x20]))
    expect(created.status).toBe(202)

    const res = await request
      .get(`/me/voice-notes/${created.body.voiceNote.id}`)
      .set('Authorization', auth(b.accessToken))
    expect(res.status).toBe(404)
  })
})

describe('POST /me/voice-notes/:id/review', () => {
  async function makeReviewNote(userId: string) {
    return VoiceNote.create({
      userId: new Types.ObjectId(userId),
      storageKey: 'k',
      durationMs: 1000,
      byteSize: 5,
      source: 'app',
      status: 'needs_review',
      clientCapturedAt: new Date(),
      reviewItems: [
        {
          key: 'k1',
          title: 'Call the vet',
          domain: 'pets',
          priority: 'normal',
          confidence: 'low',
          reviewReason: 'ambiguous_intent',
          reasons: ['Not sure when'],
        },
        {
          key: 'k2',
          title: 'Maybe buy milk',
          domain: 'home',
          priority: 'normal',
          confidence: 'low',
          reviewReason: 'incomplete',
          reasons: [],
        },
      ],
    })
  }

  it('accepts an edited item, discards another, and clears to ready', async () => {
    const session = await signUp()
    const note = await makeReviewNote(session.userId)

    const res = await request
      .post(`/me/voice-notes/${note.id}/review`)
      .set('Authorization', auth(session.accessToken))
      .send({ accepts: [{ key: 'k1', title: 'Call the vet today' }], discards: ['k2'] })

    expect(res.status).toBe(200)
    expect(res.body.tasks).toHaveLength(1)
    expect(res.body.tasks[0].title).toBe('Call the vet today')
    expect(res.body.voiceNote.status).toBe('ready')
    expect(res.body.voiceNote.reviewItems).toHaveLength(0)

    const tasks = await Task.find({ sourceVoiceNoteId: note._id })
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.confidence).toBe('high') // user-confirmed
  })

  it('stays needs_review while items remain', async () => {
    const session = await signUp()
    const note = await makeReviewNote(session.userId)

    const res = await request
      .post(`/me/voice-notes/${note.id}/review`)
      .set('Authorization', auth(session.accessToken))
      .send({ accepts: [{ key: 'k1' }], discards: [] })

    expect(res.status).toBe(200)
    expect(res.body.voiceNote.status).toBe('needs_review')
    expect(res.body.voiceNote.reviewItems).toHaveLength(1)
    expect(res.body.voiceNote.reviewItems[0].key).toBe('k2')
  })

  it('is idempotent — re-accepting the same key never double-creates', async () => {
    const session = await signUp()
    const note = await makeReviewNote(session.userId)
    const body = { accepts: [{ key: 'k1' }], discards: [] }

    await request
      .post(`/me/voice-notes/${note.id}/review`)
      .set('Authorization', auth(session.accessToken))
      .send(body)
    // Second call with the same key (already handled / stale) is a no-op.
    await request
      .post(`/me/voice-notes/${note.id}/review`)
      .set('Authorization', auth(session.accessToken))
      .send(body)

    const tasks = await Task.find({ sourceVoiceNoteId: note._id, sourceTaskKey: 'k1' })
    expect(tasks).toHaveLength(1)
  })

  it('rejects another user\'s note', async () => {
    const a = await signUp()
    const b = await signUp()
    const note = await makeReviewNote(a.userId)
    const res = await request
      .post(`/me/voice-notes/${note.id}/review`)
      .set('Authorization', auth(b.accessToken))
      .send({ accepts: [], discards: [] })
    expect(res.status).toBe(404)
  })
})

// This route used to destructure only {autoSave, review} from the gate, so a
// manual re-extract silently threw away every answerable question the worker
// path would have held — the item existed nowhere the user could reach it.
describe('POST /me/voice-notes/:id/extract-tasks — clarify lane', () => {
  const clarifiable: DraftItem = {
    title: 'Car insurance renewal',
    domain: 'car',
    priority: 'high',
    confidence: 'low',
    reviewReason: 'vague_date',
    reasons: [],
    clarification: {
      question: 'Is it the 15th or the 18th?',
      kind: 'date',
      costOfWrong: 'high',
      options: [
        { label: 'The 15th', dueAt: new Date('2026-06-15T09:00:00.000Z') },
        { label: 'The 18th', dueAt: new Date('2026-06-18T09:00:00.000Z') },
      ],
    },
  }

  async function noteWithTranscript(userId: string) {
    return VoiceNote.create({
      userId: new Types.ObjectId(userId),
      storageKey: 'k',
      durationMs: 1500,
      byteSize: 5,
      source: 'app',
      status: 'ready',
      clientCapturedAt: new Date(),
      transcript: 'renew the car insurance on the 15th or 18th',
      timezone: 'Africa/Cairo',
    })
  }

  it('persists held items instead of dropping them', async () => {
    const session = await signUp()
    const note = await noteWithTranscript(session.userId)
    extractMock.mockResolvedValueOnce([clarifiable])

    const res = await request
      .post(`/me/voice-notes/${note.id}/extract-tasks`)
      .set('Authorization', auth(session.accessToken))
      .send({})
    expect(res.status).toBe(200)

    const held = await Clarification.find({ userId: session.userId, status: 'open' })
    expect(held).toHaveLength(1)
    expect(held[0]?.question).toBe('Is it the 15th or the 18th?')

    // The task exists NOW, carrying the first option as a provisional guess.
    // It used to be withheld until the question was answered, which is what
    // made a captured item invisible and unreachable.
    const task = await Task.findById(held[0]?.taskId)
    expect(task?.title).toBe('Car insurance renewal')
    expect(task?.dueAt?.toISOString()).toBe('2026-06-15T09:00:00.000Z')
    // Passive until confirmed — a guessed renewal date must not fire.
    expect(task?.kind).toBe('list')
  })

  it('is idempotent — re-extracting does not duplicate the question', async () => {
    const session = await signUp()
    const note = await noteWithTranscript(session.userId)
    extractMock.mockResolvedValueOnce([clarifiable]).mockResolvedValueOnce([clarifiable])

    for (let i = 0; i < 2; i += 1) {
      await request
        .post(`/me/voice-notes/${note.id}/extract-tasks`)
        .set('Authorization', auth(session.accessToken))
        .send({})
    }
    expect(await Clarification.countDocuments({ userId: session.userId, status: 'open' })).toBe(1)
  })
})

// Touch the import so tsc doesn't complain about an unused module.
void getVoiceNoteStorage
