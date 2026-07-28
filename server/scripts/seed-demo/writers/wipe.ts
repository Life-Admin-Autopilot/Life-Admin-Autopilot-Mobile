import { rm } from 'node:fs/promises'
import type { Types } from 'mongoose'

import { Task } from '../../../src/models/Task'
import { VoiceNote } from '../../../src/models/VoiceNote'
import { ScannedDocument } from '../../../src/models/ScannedDocument'
import { Clarification } from '../../../src/models/Clarification'
import { Notification } from '../../../src/models/Notification'
import { AiConversation } from '../../../src/models/AiConversation'
import { DailyDigest } from '../../../src/models/DailyDigest'
import { TaskBulkOp } from '../../../src/models/TaskBulkOp'
import { AiUsageCounter } from '../../../src/models/AiUsageCounter'
import { DocumentScanUsageCounter } from '../../../src/models/DocumentScanUsageCounter'

// Scoped wipe. EVERY query here is filtered by userId — this runs against the
// live Atlas cluster, and a missing filter would take out other accounts'
// data with no way back.

interface Deletable {
  modelName: string
  countDocuments(filter: Record<string, unknown>): Promise<number>
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>
}

const COLLECTIONS: Deletable[] = [
  Task,
  VoiceNote,
  ScannedDocument,
  Clarification,
  Notification,
  AiConversation,
  DailyDigest,
  TaskBulkOp,
  AiUsageCounter,
  DocumentScanUsageCounter,
] as unknown as Deletable[]

export async function countUserData(userId: Types.ObjectId): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const model of COLLECTIONS) {
    out[model.modelName] = await model.countDocuments({ userId })
  }
  return out
}

export async function wipeUserData(userId: Types.ObjectId): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const model of COLLECTIONS) {
    const res = await model.deleteMany({ userId })
    out[model.modelName] = res.deletedCount ?? 0
  }
  return out
}

/**
 * The scanned-document bytes on local disk. Removed alongside the rows so a
 * re-seed doesn't leave orphaned PDFs from the previous run accumulating.
 */
export async function wipeUserUploads(storageRoot: string, userId: string): Promise<void> {
  await rm(`${storageRoot}/${userId}`, { recursive: true, force: true })
}
