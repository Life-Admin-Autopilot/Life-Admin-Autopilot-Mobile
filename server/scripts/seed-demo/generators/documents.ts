import { Types } from 'mongoose'

import { buildStorageKey, getDocumentScanStorage } from '../../../src/lib/documentScanStorage'
import { DOCUMENT_SUBTITLE_MAX } from '../../../src/models/ScannedDocument'
import { DOCUMENT_TEMPLATES, type DocumentTemplate } from '../catalog/documents'
import { CURRENCY, PENDING, TIMEZONE, VOLUMES } from '../config'
import { addDays, atTime, partsAt, startOfDay } from '../calendar'
import { buildDocumentPdf, type PdfPage } from '../pdf/buildDocumentPdf'
import { buildDocumentPhoto } from '../pdf/buildDocumentPhoto'
import type { Rng } from '../rng'
import type { SeedDoc } from '../writers/insert'
import { makeTask, type TaskSeed } from './taskFactory'

// Scanned documents — rows in Mongo AND bytes on disk, because /documents can
// open the original.

export interface DocumentResult {
  documents: SeedDoc[]
  /** Matters filed from accepted candidates. */
  tasks: TaskSeed[]
  /** Absolute paths written, for the manifest's purge list. */
  files: string[]
}

const WEIGHTED = DOCUMENT_TEMPLATES.map((t) => [t, t.weight] as const)

function shortDate(instant: Date): string {
  const p = partsAt(instant)
  const month = new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString('en-GB', {
    month: 'short',
    timeZone: 'UTC',
  })
  return `${p.day} ${month} ${p.year}`
}

interface Vars {
  AMOUNT: string
  MIN: string
  DUE: string
  ISSUED: string
  METER: string
  REF: string
  PERIOD: string
}

function render(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key as keyof Vars] ?? whole)
}

function buildVars(t: DocumentTemplate, issued: Date, due: Date, rng: Rng): Vars {
  const amount = t.amount ? Math.round(rng.int(t.amount[0], t.amount[1]) / 5) * 5 : 0
  const p = partsAt(issued)
  return {
    AMOUNT: `${amount.toLocaleString('en-GB')} ${CURRENCY}`,
    MIN: `${Math.round((amount * 0.05) / 5) * 5} ${CURRENCY}`,
    DUE: shortDate(due),
    ISSUED: shortDate(issued),
    METER: String(rng.int(180, 24_000)),
    REF: String(rng.int(100_000, 999_999)),
    PERIOD: `Q${Math.ceil(p.month / 3)} ${p.year}`,
  }
}

// The list row's one-line description, written most-important-token-first so
// it survives truncation.
function subtitleFor(t: DocumentTemplate, vars: Vars, due: Date, now: Date): string {
  const parts: string[] = []
  if (t.candidates.length > 0) {
    parts.push(due < now ? `Was due ${shortDate(due)}` : `Due ${shortDate(due)}`)
  }
  if (t.amount) parts.push(vars.AMOUNT)
  if (parts.length === 0) parts.push(t.issuer)
  return parts.join(' · ').slice(0, DOCUMENT_SUBTITLE_MAX)
}

function pagesFor(t: DocumentTemplate, vars: Vars, twoPage: boolean): PdfPage[] {
  const first: PdfPage = {
    heading: t.heading,
    contact: t.contact,
    fields: t.fields.map(([label, value]) => [label, render(value, vars)] as [string, string]),
    body: t.body.map((line) => render(line, vars)),
    footer: t.footer,
  }
  if (!twoPage) return [first]

  return [
    first,
    {
      heading: `${t.heading} — continued`,
      contact: t.contact,
      fields: [
        ['Reference', `ETA-${vars.REF}`],
        ['Issued', vars.ISSUED],
      ],
      body: [
        'This page carries the terms referred to overleaf. Nothing on it',
        'changes the amounts or the dates stated on the first page.',
        '',
        'Queries must quote the reference above and be raised within 30 days',
        'of the issue date.',
      ],
      footer: 'End of document.',
    },
  ]
}

export async function buildDocuments(args: {
  rng: Rng
  userId: Types.ObjectId
  now: Date
  windowStart: Date
  /** False under --dry-run: build the bytes, don't touch the disk. */
  write: boolean
}): Promise<DocumentResult> {
  const { rng, userId, now, windowStart, write } = args
  const storage = getDocumentScanStorage()
  const todayStart = startOfDay(now)
  const span = todayStart.getTime() - windowStart.getTime()

  const documents: SeedDoc[] = []
  const tasks: TaskSeed[] = []
  const files: string[] = []

  for (let i = 0; i < VOLUMES.documents; i += 1) {
    const t = rng.weighted(WEIGHTED)
    const docId = new Types.ObjectId()

    // The last few are the ones still waiting on the user — placed most
    // recently, because a scan from two years ago that was never reviewed
    // would be a bug rather than a backlog.
    const awaiting = i >= VOLUMES.documents - PENDING.scansAwaitingReview
    const capturedAt = awaiting
      ? atTime(addDays(todayStart, -rng.int(0, 5)), rng.int(9, 21))
      : atTime(
          new Date(windowStart.getTime() + Math.pow(rng.next(), 0.75) * span),
          rng.int(9, 21),
        )

    const primaryDue = addDays(capturedAt, t.candidates[0]?.dueOffset ?? 14)
    const vars = buildVars(t, capturedAt, primaryDue, rng)

    // A fifth of scans are phone photos rather than PDFs. Photos are always
    // single-page — you can't take one picture of a two-page letter.
    const asPhoto = rng.chance(0.2)
    const twoPage = !asPhoto && rng.chance(0.25)
    const pages = pagesFor(t, vars, twoPage)
    const mimeType = asPhoto ? 'image/jpeg' : 'application/pdf'
    const bytes = asPhoto
      ? await buildDocumentPhoto(pages[0]!)
      : await buildDocumentPdf(pages)

    const key = buildStorageKey(userId.toHexString(), docId.toHexString(), mimeType)
    if (write) await storage.put(key, bytes)
    files.push(key)

    // Extraction finished a minute or two after the upload.
    const processedAt = new Date(capturedAt.getTime() + rng.int(20_000, 180_000))

    const candidates = t.candidates.map((c, n) => {
      const dueAt = addDays(capturedAt, c.dueOffset)
      const base = {
        key: `${docId.toHexString()}-${n}`,
        title: c.title,
        domain: c.domain,
        priority: c.priority,
        confidence: rng.weighted([
          ['high', 60],
          ['medium', 32],
          ['low', 8],
        ] as const),
        estimate: { minMinutes: c.estimate[0], maxMinutes: c.estimate[1], source: 'ai' as const },
        dueAt,
        sourcePage: twoPage ? rng.int(1, 2) : 1,
      }

      // Everything on an awaiting scan is still held — no taskId, which is
      // exactly what the unresolved dot on the row keys off.
      if (awaiting) return base

      const past = dueAt < todayStart
      const task = makeTask(
        {
          userId,
          title: c.title,
          domain: c.domain,
          kind: 'reminder',
          priority: c.priority,
          status: past ? 'done' : 'open',
          createdAt: processedAt,
          dueAt,
          notes: `From the ${t.documentTitle.toLowerCase()} scanned on ${shortDate(capturedAt)}.`,
          tags: [t.type, 'scanned'],
          estimate: c.estimate,
          completedAt: past
            ? new Date(
                Math.min(addDays(dueAt, -rng.int(0, 2)).getTime(), now.getTime()),
              )
            : undefined,
          sourceDocumentId: docId,
          sourceTaskKey: base.key,
          confidence: base.confidence,
        },
        now,
        rng,
      )
      tasks.push(task)
      return { ...base, taskId: task._id }
    })

    documents.push({
      _id: docId,
      userId,
      storageKey: key,
      mimeType,
      // Kept honest against the bytes: a photo came from the camera or the
      // gallery, a PDF arrived as a file.
      sourceType: asPhoto
        ? rng.weighted([
            ['camera', 80],
            ['gallery', 20],
          ] as const)
        : 'pdf',
      pageCount: twoPage ? 2 : 1,
      byteSize: bytes.length,
      status: 'ready_for_review',
      rawExtractedText: [t.heading, ...t.body].map((line) => render(line, vars)).join('\n'),
      documentSummary: t.summary,
      documentType: t.type,
      documentTitle: t.documentTitle,
      documentSubtitle: subtitleFor(t, vars, primaryDue, now),
      issuer: t.issuer,
      candidates,
      clientCapturedAt: capturedAt,
      timezone: TIMEZONE,
      attempts: 1,
      maxAttempts: 4,
      lockedUntil: null,
      nextRunAt: capturedAt,
      // The stamp that means "every candidate has been dealt with". Its
      // ABSENCE is what /dashboard counts as awaiting review — the
      // ready_for_review status alone is just terminal success.
      reviewedAt: awaiting ? undefined : new Date(processedAt.getTime() + rng.int(60_000, 86_400_000)),
      notifiedAt: new Date(processedAt.getTime() + rng.int(5_000, 60_000)),
      createdAt: capturedAt,
      updatedAt: processedAt,
    })
  }

  return { documents, tasks, files }
}
