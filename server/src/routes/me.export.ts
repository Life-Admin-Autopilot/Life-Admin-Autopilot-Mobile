import { Router } from 'express'
import { asyncHandler, NotFound, Unauthorized } from '../lib/errors'
import { requireAuth } from '../middleware/auth'
import { AiConversation } from '../models/AiConversation'
import { AiUsageCounter } from '../models/AiUsageCounter'
import { Clarification } from '../models/Clarification'
import { DailyDigest } from '../models/DailyDigest'
import { DocumentScanUsageCounter } from '../models/DocumentScanUsageCounter'
import { Notification } from '../models/Notification'
import { RefreshToken } from '../models/RefreshToken'
import { ScannedDocument } from '../models/ScannedDocument'
import { Task } from '../models/Task'
import { TaskBulkOp } from '../models/TaskBulkOp'
import { User } from '../models/User'
import { VoiceNote } from '../models/VoiceNote'

// Everything Kitto holds about one account, as a single JSON file.
//
// Two rules govern what goes in. Nothing that is a CREDENTIAL ships — no
// `passwordHash`, no refresh `tokenHash`, no verification tokens at all; an
// export that leaks a live session is a breach wearing a compliance badge. And
// nothing that is a BLOB ships — voice audio and scanned originals stay on
// disk, since inlining them would turn a settings tap into a 200 MB response.
// Their metadata and extracted text do ship, which is the part that is actually
// about the user.

export const meExportRouter = Router()

// A generous ceiling that still bounds the response. A heavier account gets a
// truncated export rather than a request that dies halfway — and `truncated`
// says so in the payload instead of quietly lying by omission.
const MAX_PER_COLLECTION = 5_000

interface Section<T> {
  count: number
  truncated: boolean
  items: T[]
}

function section<T>(items: T[]): Section<T> {
  return {
    count: items.length,
    truncated: items.length === MAX_PER_COLLECTION,
    items,
  }
}

meExportRouter.get(
  '/me/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = req.auth
    if (!auth) throw Unauthorized()

    const user = await User.findById(auth.sub)
    if (!user) throw NotFound('user_not_found', 'Account no longer exists.')

    const userId = user._id
    const scope = { userId }
    const limit = MAX_PER_COLLECTION

    const [
      matters,
      bulkOps,
      voiceNotes,
      documents,
      conversations,
      clarifications,
      digests,
      notifications,
      aiUsage,
      scanUsage,
      sessions,
    ] = await Promise.all([
      Task.find(scope).limit(limit).lean(),
      TaskBulkOp.find(scope).limit(limit).lean(),
      // `storageKey` is an internal disk path, not user data — drop it here the
      // same way each model's toJSON drops it for API responses.
      VoiceNote.find(scope, { storageKey: 0 }).limit(limit).lean(),
      ScannedDocument.find(scope, { storageKey: 0 }).limit(limit).lean(),
      AiConversation.find(scope).limit(limit).lean(),
      Clarification.find(scope).limit(limit).lean(),
      DailyDigest.find(scope).limit(limit).lean(),
      Notification.find(scope).limit(limit).lean(),
      AiUsageCounter.find(scope).limit(limit).lean(),
      DocumentScanUsageCounter.find(scope).limit(limit).lean(),
      // Never the hash — that IS the credential. What's useful to a person is
      // the device history: what signed in, from where, and when.
      RefreshToken.find(scope, { tokenHash: 0, replacedBy: 0 }).limit(limit).lean(),
    ])

    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      // toJSON already strips passwordHash and maps _id → id.
      user: user.toJSON(),
      matters: section(matters),
      bulkOperations: section(bulkOps),
      voiceNotes: section(voiceNotes),
      documents: section(documents),
      conversations: section(conversations),
      clarifications: section(clarifications),
      dailyDigests: section(digests),
      notifications: section(notifications),
      aiUsage: section(aiUsage),
      documentScanUsage: section(scanUsage),
      sessions: section(sessions),
    }

    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="kitto-export-${stamp}.json"`)
    res.status(200).send(JSON.stringify(payload, null, 2))
  }),
)
