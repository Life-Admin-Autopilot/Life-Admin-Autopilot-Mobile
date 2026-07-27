import { describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
import { auth, request, signUp } from '../test/helpers'
import { getDocumentScanStorage } from '../lib/documentScanStorage'
import { ScannedDocument } from '../models/ScannedDocument'
import { Notification } from '../models/Notification'
import { Task } from '../models/Task'
import { DocumentScanUsageCounter, utcMonthBucket } from '../models/DocumentScanUsageCounter'

// In-memory storage double, same shape as me.voiceNotes.test.ts's — the real
// LocalDiskStorage would write into the repo during a test run.
vi.mock('../lib/documentScanStorage', () => {
  const store = new Map<string, Buffer>()
  return {
    getDocumentScanStorage: () => ({
      put: async (k: string, b: Buffer) => {
        store.set(k, b)
      },
      get: async (k: string) => {
        const v = store.get(k)
        if (!v) throw new Error('missing')
        return v
      },
      remove: async (k: string) => {
        if (!store.has(k)) throw new Error('ENOENT')
        store.delete(k)
      },
    }),
    buildStorageKey: (u: string, id: string) => `${u}/${id}.pdf`,
  }
})

// Seeds a ready-for-review scan directly, skipping the upload route — these
// tests are about deletion, not ingestion, and the upload path's page-count
// parse would need a real PDF.
async function seedScan(userId: string, overrides: Record<string, unknown> = {}) {
  const id = new Types.ObjectId()
  const storageKey = `${userId}/${id.toHexString()}.pdf`
  await getDocumentScanStorage().put(storageKey, Buffer.from([0x25, 0x50, 0x44, 0x46]))
  return ScannedDocument.create({
    _id: id,
    userId,
    storageKey,
    mimeType: 'application/pdf',
    sourceType: 'pdf',
    pageCount: 1,
    byteSize: 4,
    status: 'ready_for_review',
    clientCapturedAt: new Date(),
    ...overrides,
  })
}

describe('DELETE /me/document-scans/:id', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request.delete(`/me/document-scans/${new Types.ObjectId().toHexString()}`)
    expect(res.status).toBe(401)
  })

  it('deletes the record and its stored bytes', async () => {
    const session = await signUp()
    const doc = await seedScan(session.userId)

    const res = await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))

    expect(res.status).toBe(204)
    expect(await ScannedDocument.findById(doc.id)).toBeNull()
    await expect(getDocumentScanStorage().get(doc.storageKey)).rejects.toThrow()
  })

  it('deletes notifications pointing at the document', async () => {
    const session = await signUp()
    const doc = await seedScan(session.userId)
    await Notification.create({
      userId: session.userId,
      kind: 'document_scan',
      documentId: doc._id,
      title: 'Scan ready to review',
      body: '1 item found — take a look.',
    })

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)

    expect(await Notification.countDocuments({ documentId: doc._id })).toBe(0)
  })

  it('leaves tasks already filed from the document intact', async () => {
    const session = await signUp()
    const doc = await seedScan(session.userId)
    const task = await Task.create({
      userId: session.userId,
      title: 'Pay electricity bill',
      domain: 'home',
      sourceDocumentId: doc._id,
    })

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)

    const survivor = await Task.findById(task.id)
    expect(survivor).not.toBeNull()
    expect(survivor?.title).toBe('Pay electricity bill')
  })

  it('does not refund the monthly quota slot', async () => {
    // The extraction cost is already sunk when the document exists, so a
    // refund here would make scan-then-delete an unlimited loop around the cap.
    const session = await signUp()
    const doc = await seedScan(session.userId)
    const month = utcMonthBucket()
    await DocumentScanUsageCounter.create({ userId: session.userId, month, count: 1 })

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)

    const counter = await DocumentScanUsageCounter.findOne({ userId: session.userId, month })
    expect(counter?.count).toBe(1)
  })

  it("refuses to delete another user's document", async () => {
    const owner = await signUp()
    const stranger = await signUp()
    const doc = await seedScan(owner.userId)

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(stranger.accessToken))
      .expect(204) // idempotent no-op, not a 404 that leaks existence

    expect(await ScannedDocument.findById(doc.id)).not.toBeNull()
  })

  it('is idempotent on a repeat delete', async () => {
    const session = await signUp()
    const doc = await seedScan(session.userId)

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)
    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)
  })

  it('still deletes the record when the stored file is already gone', async () => {
    const session = await signUp()
    const doc = await seedScan(session.userId)
    await getDocumentScanStorage().remove(doc.storageKey)

    await request
      .delete(`/me/document-scans/${doc.id}`)
      .set('Authorization', auth(session.accessToken))
      .expect(204)

    expect(await ScannedDocument.findById(doc.id)).toBeNull()
  })
})

describe('GET /me/document-scans', () => {
  it('returns the new row-copy fields and never leaks the storage key', async () => {
    const session = await signUp()
    await seedScan(session.userId, {
      documentType: 'bill',
      documentTitle: 'Electricity bill',
      documentSubtitle: 'Due July 30 · $142.37',
      issuer: 'City Power',
      documentSummary: 'An electricity bill from City Power, totaling $142.37 and due July 30.',
    })

    const res = await request
      .get('/me/document-scans')
      .set('Authorization', auth(session.accessToken))
      .expect(200)

    const [row] = res.body.scannedDocuments
    expect(row.documentType).toBe('bill')
    expect(row.documentTitle).toBe('Electricity bill')
    expect(row.documentSubtitle).toBe('Due July 30 · $142.37')
    expect(row.issuer).toBe('City Power')
    expect(row.storageKey).toBeUndefined()
  })
})
