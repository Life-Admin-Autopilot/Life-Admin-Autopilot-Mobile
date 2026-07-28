// Fill an account with three years of plausible daily use.
//
//   npx tsx scripts/seed-demo/index.ts --wipe
//   npx tsx scripts/seed-demo/index.ts --dry-run
//   npx tsx scripts/seed-demo/index.ts --purge
//
// This writes to whatever MONGODB_URI points at, which is a live Atlas cluster.
// Every query it issues is scoped to ONE user id.

import 'dotenv/config'
import { join } from 'node:path'
import { Types } from 'mongoose'

import { connectDb, disconnectDb } from '../../src/db'
import { env } from '../../src/env'
import { User } from '../../src/models/User'
import { Task } from '../../src/models/Task'
import { VoiceNote } from '../../src/models/VoiceNote'
import { ScannedDocument } from '../../src/models/ScannedDocument'
import { Clarification } from '../../src/models/Clarification'
import { Notification } from '../../src/models/Notification'
import { AiConversation } from '../../src/models/AiConversation'
import { AiUsageCounter } from '../../src/models/AiUsageCounter'
import { DocumentScanUsageCounter } from '../../src/models/DocumentScanUsageCounter'

import { DEFAULT_SEED, DISPLAY_NAME, HISTORY_START, SEED_EMAIL } from './config'
import { partsAt } from './calendar'
import { Rng } from './rng'
import { buildRecurringTasks } from './generators/recurringTasks'
import { buildOneOffTasks } from './generators/oneOffTasks'
import { buildLiveTasks } from './generators/liveTasks'
import { buildDocuments } from './generators/documents'
import { buildVoiceNotes } from './generators/voiceNotes'
import { buildClarifications } from './generators/clarifications'
import { buildNotifications } from './generators/notifications'
import { buildConversation } from './generators/conversation'
import { buildCounters } from './generators/counters'
import { beginManifest, insertAll, loadManifest, recordFile, saveManifest } from './writers/insert'
import { countUserData, wipeUserData, wipeUserUploads } from './writers/wipe'
import { checkTasks, describeLive } from './writers/invariants'

interface Args {
  email: string
  wipe: boolean
  dryRun: boolean
  purge: boolean
  seed: number
}

function parseArgs(argv: string[]): Args {
  const flag = (name: string): boolean => argv.includes(`--${name}`)
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
  }
  return {
    email: (value('email') ?? SEED_EMAIL).toLowerCase().trim(),
    wipe: flag('wipe'),
    dryRun: flag('dry-run'),
    purge: flag('purge'),
    seed: Number(value('seed') ?? DEFAULT_SEED),
  }
}

function storageRoot(): string {
  return env().DOCUMENT_SCAN_STORAGE_DIR ?? join(process.cwd(), 'uploads', 'document-scans')
}

function table(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `    ${k.padEnd(28)} ${String(n).padStart(6)}`)
    .join('\n')
}

// Undo a previous run using the ids it recorded. Preferred over a wipe when
// the account has data that did NOT come from the seed.
async function purge(): Promise<void> {
  const manifest = await loadManifest()
  if (!manifest) {
    console.error('No .last-run.json to purge from.')
    return
  }
  // Structural, not a union of eight Model types: TypeScript can't pick a
  // callable signature out of that union, and every one of them has the same
  // deleteMany shape anyway.
  interface Purgeable {
    deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>
  }
  const models: Record<string, Purgeable> = {
    Task,
    VoiceNote,
    ScannedDocument,
    Clarification,
    Notification,
    AiConversation,
    AiUsageCounter,
    DocumentScanUsageCounter,
  } as unknown as Record<string, Purgeable>

  const removed: Record<string, number> = {}
  for (const [name, ids] of Object.entries(manifest.ids)) {
    const model = models[name]
    if (!model) continue
    const res = await model.deleteMany({
      _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
    })
    removed[name] = res.deletedCount ?? 0
  }
  await wipeUserUploads(storageRoot(), manifest.userId)
  console.log(`Purged run from ${manifest.seededAt}:\n${table(removed)}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  await connectDb()

  if (args.purge) {
    await purge()
    await disconnectDb()
    return
  }

  const user = await User.findOne({ email: args.email })
  if (!user) {
    console.error(`No user found for ${args.email}. Sign up first, then re-run.`)
    await disconnectDb()
    process.exit(1)
  }

  const userId = user._id as Types.ObjectId
  const now = new Date()
  const windowStart = new Date(HISTORY_START)
  const rng = new Rng(args.seed)

  console.log(`\nSeeding ${args.email} (${userId.toHexString()})`)
  console.log(`  seed=${args.seed}  window=${HISTORY_START.slice(0, 10)} → now`)

  const existing = await countUserData(userId)
  const existingTotal = Object.values(existing).reduce((a, b) => a + b, 0)
  if (existingTotal > 0) {
    console.log(`\n  Existing data for this account:\n${table(existing)}`)
  }

  if (args.wipe && !args.dryRun) {
    const removed = await wipeUserData(userId)
    await wipeUserUploads(storageRoot(), userId.toHexString())
    console.log(`\n  Wiped:\n${table(removed)}`)
  } else if (args.wipe) {
    console.log('\n  [dry-run] would wipe the rows above.')
  }

  // ---- Build everything in memory first ----
  //
  // Order matters: documents and voice notes write back-links onto the task
  // documents, so nothing may be inserted until every generator has run.

  beginManifest(userId.toHexString(), args.seed, now)

  const recurring = buildRecurringTasks({ rng, userId, now, windowStart })
  const oneOffs = buildOneOffTasks({ rng, userId, now, windowStart })
  const live = buildLiveTasks({ rng, userId, now })

  const docs = await buildDocuments({ rng, userId, now, windowStart, write: !args.dryRun })

  // Voice notes claim credit only for matters a person would actually dictate:
  // one-offs and live items. A recurring bill was never spoken into a phone.
  const { notes, attributed } = buildVoiceNotes({
    rng,
    userId,
    now,
    tasks: [...oneOffs, ...live],
  })

  const tasks = [...recurring, ...oneOffs, ...live, ...docs.tasks]

  const clarifications = buildClarifications({ rng, userId, now, windowStart, tasks })
  const notifications = buildNotifications({
    rng,
    userId,
    now,
    tasks,
    documents: docs.documents,
    clarifications,
  })
  const conversation = buildConversation({ rng, userId, now, tasks })

  const thisMonth = now.toISOString().slice(0, 7)
  const scansThisMonth = docs.documents.filter(
    (d) => (d.clientCapturedAt as Date).toISOString().slice(0, 7) === thisMonth,
  ).length
  const counters = buildCounters({ rng, userId, now, scansThisMonth })

  const summary: Record<string, number> = {
    'Task (recurring)': recurring.length,
    'Task (one-off)': oneOffs.length,
    'Task (live backlog)': live.length,
    'Task (from documents)': docs.tasks.length,
    'Task (voice-attributed)': attributed.length,
    VoiceNote: notes.length,
    ScannedDocument: docs.documents.length,
    Clarification: clarifications.length,
    Notification: notifications.length,
    AiConversation: 1,
    AiUsageCounter: counters.ai.length,
    DocumentScanUsageCounter: counters.scans.length,
  }

  // Nothing is written until the dataset passes. A run that would leave the
  // reminder worker a backlog to fire is not worth inspecting afterwards.
  const violations = checkTasks(tasks, now)
  if (violations.length > 0) {
    console.error(`\n  ${violations.length} invariant violation(s):`)
    for (const v of violations) console.error(`    ${v.rule.padEnd(26)} ${v.detail}`)
    await disconnectDb()
    process.exit(1)
  }

  console.log(`\n  What the app will show:\n${table(describeLive(tasks, now))}`)

  if (args.dryRun) {
    console.log(`\n  [dry-run] would insert:\n${table(summary)}`)
    console.log(`\n  [dry-run] would write ${docs.files.length} PDFs under ${storageRoot()}`)
    await disconnectDb()
    return
  }

  // ---- Write ----

  await insertAll(Task, tasks)
  await insertAll(VoiceNote, notes)
  await insertAll(ScannedDocument, docs.documents)
  await insertAll(Clarification, clarifications)
  await insertAll(Notification, notifications)
  await insertAll(AiConversation, [conversation])
  await insertAll(AiUsageCounter, counters.ai)
  await insertAll(DocumentScanUsageCounter, counters.scans)
  for (const file of docs.files) recordFile(file)

  // The account itself has to match the story. A user with three years of
  // matters who signed up three months ago falls apart the moment anyone
  // looks at the profile screen. `timestamps: false` so the update doesn't
  // immediately stamp updatedAt back to today.
  await User.collection.updateOne(
    { _id: userId },
    {
      $set: {
        displayName: DISPLAY_NAME,
        hasOnboarded: true,
        createdAt: windowStart,
        onboardingAnswers: [
          { id: 'focus', question: 'What weighs on you most?', answer: 'Renewals & bills' },
          { id: 'pace', question: 'How full is your week?', answer: 'Packed' },
          { id: 'tone', question: 'How should I speak to you?', answer: 'Briefly' },
        ],
      },
    },
  )

  const manifestPath = await saveManifest()

  console.log(`\n  Inserted:\n${table(summary)}`)
  console.log(`\n  Wrote ${docs.files.length} PDFs under ${storageRoot()}`)
  console.log(`  Manifest: ${manifestPath}`)

  // ---- What the screens should now show ----
  const p = partsAt(now)
  console.log(`\n  Local date in the persona's zone: ${p.year}-${p.month}-${p.day}`)
  console.log('  DailyDigest was NOT seeded — it is a hash-keyed cache and')
  console.log('  rebuilds itself on the first dashboard load.\n')

  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
