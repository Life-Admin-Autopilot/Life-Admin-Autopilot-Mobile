// Read the seeded account back the way the app reads it.
//
//   npx tsx scripts/seed-demo/verify.ts
//
// Written as a separate pass on purpose: the generators asserting about their
// own output only proves they are self-consistent. This asks Mongo the same
// questions the routes ask, so a field that failed to cast, an index that
// rejected a row, or a date that survived the generator but not the schema
// shows up here.

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { connectDb, disconnectDb } from '../../src/db'
import { env } from '../../src/env'
import { User } from '../../src/models/User'
import { Task, notDeleted } from '../../src/models/Task'
import { VoiceNote } from '../../src/models/VoiceNote'
import { ScannedDocument } from '../../src/models/ScannedDocument'
import { Clarification } from '../../src/models/Clarification'
import { Notification } from '../../src/models/Notification'
import { AiConversation } from '../../src/models/AiConversation'

import { SEED_EMAIL } from './config'
import { addDays, startOfDay } from './calendar'

const DAY_MS = 86_400_000

function line(label: string, value: string | number, flag?: 'ok' | 'bad'): void {
  const mark = flag === 'bad' ? ' ✗' : flag === 'ok' ? ' ✓' : ''
  console.log(`  ${label.padEnd(36)} ${String(value).padStart(6)}${mark}`)
}

async function main(): Promise<void> {
  await connectDb()
  const email = (process.argv[2] ?? SEED_EMAIL).toLowerCase().trim()
  const user = await User.findOne({ email }).lean()
  if (!user) {
    console.error(`No user for ${email}`)
    await disconnectDb()
    process.exit(1)
  }
  const userId = user._id
  const now = new Date()
  const today = startOfDay(now)
  const live = { userId, ...notDeleted(), status: { $in: ['open', 'snoozed'] } }

  console.log(`\nAccount ${email}`)
  line('member since', String((user as unknown as { createdAt: Date }).createdAt).slice(0, 15))

  console.log('\nCollections')
  line('Task (live)', await Task.countDocuments({ userId, ...notDeleted() }))
  line('Task (in trash)', await Task.countDocuments({ userId, deletedAt: { $exists: true } }))
  line('VoiceNote', await VoiceNote.countDocuments({ userId }))
  line('ScannedDocument', await ScannedDocument.countDocuments({ userId }))
  line('Clarification', await Clarification.countDocuments({ userId }))
  line('Notification', await Notification.countDocuments({ userId }))
  line('AiConversation', await AiConversation.countDocuments({ userId }))

  console.log('\nMatters, as /matters groups them')
  line('open + snoozed', await Task.countDocuments(live))
  line('overdue', await Task.countDocuments({ ...live, dueAt: { $lt: today } }))
  line(
    'today',
    await Task.countDocuments({ ...live, dueAt: { $gte: today, $lt: addDays(today, 1) } }),
  )
  line(
    'tomorrow',
    await Task.countDocuments({
      ...live,
      dueAt: { $gte: addDays(today, 1), $lt: addDays(today, 2) },
    }),
  )
  line(
    'this week',
    await Task.countDocuments({
      ...live,
      dueAt: { $gte: addDays(today, 2), $lt: addDays(today, 7) },
    }),
  )
  line('no date', await Task.countDocuments({ ...live, dueAt: { $exists: false } }))
  line('done (archive)', await Task.countDocuments({ userId, ...notDeleted(), status: 'done' }))

  // The same slipping rule taskCounts and dailyDigest share.
  line(
    'slipping',
    await Task.countDocuments({
      ...live,
      $or: [
        { rescheduleCount: { $gte: 3 } },
        { dueAt: { $lt: new Date(today.getTime() - 14 * DAY_MS) } },
      ],
    }),
  )

  console.log('\nWaiting on the user')
  line(
    'scans awaiting review',
    await ScannedDocument.countDocuments({
      userId,
      status: 'ready_for_review',
      reviewedAt: { $exists: false },
    }),
  )
  line('open clarifications', await Clarification.countDocuments({ userId, status: 'open' }))
  line(
    'unread notifications',
    await Notification.countDocuments({ userId, readAt: { $exists: false } }),
  )
  line(
    'voice notes in review',
    await VoiceNote.countDocuments({ userId, status: 'needs_review' }),
  )

  console.log('\nHazards')

  // THE one that matters. This is the exact filter startReminderWorker uses;
  // anything it returns is a notification that fires on the next tick.
  const wouldFire = await Task.countDocuments({
    userId,
    status: { $in: ['open', 'snoozed'] },
    reminders: { $elemMatch: { firedAt: null, at: { $lte: now } } },
  })
  line('reminders that would fire now', wouldFire, wouldFire === 0 ? 'ok' : 'bad')

  // A job the worker would reclaim and re-run through Gemini.
  const claimableNotes = await VoiceNote.countDocuments({
    userId,
    status: { $in: ['pending', 'transcribing', 'extracting'] },
  })
  line('voice notes worker would claim', claimableNotes, claimableNotes === 0 ? 'ok' : 'bad')

  const claimableScans = await ScannedDocument.countDocuments({
    userId,
    status: { $in: ['pending', 'processing'] },
  })
  line('scans worker would claim', claimableScans, claimableScans === 0 ? 'ok' : 'bad')

  const futureCreated = await Task.countDocuments({ userId, createdAt: { $gt: now } })
  line('matters created in the future', futureCreated, futureCreated === 0 ? 'ok' : 'bad')

  const reminderNoDue = await Task.countDocuments({
    userId,
    kind: 'reminder',
    dueAt: { $exists: false },
  })
  line('reminders with no deadline', reminderNoDue, reminderNoDue === 0 ? 'ok' : 'bad')

  // Every scan's bytes must be on disk, or "view the original" 500s.
  const root = env().DOCUMENT_SCAN_STORAGE_DIR ?? join(process.cwd(), 'uploads', 'document-scans')
  const scans = await ScannedDocument.find({ userId }, { storageKey: 1, mimeType: 1 }).lean()
  const missing = scans.filter((s) => !existsSync(join(root, s.storageKey))).length
  line('scans with missing bytes', missing, missing === 0 ? 'ok' : 'bad')
  line('  of which photos', scans.filter((s) => s.mimeType !== 'application/pdf').length)

  console.log('')
  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
