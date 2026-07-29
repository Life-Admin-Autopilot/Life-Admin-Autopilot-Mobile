// One-off migration: give every pre-existing Clarification a real Task.
//
// Clarification.taskId is now REQUIRED, but rows written before the optimistic
// change hold only a `draft` — a task that was never created. This materializes
// each open draft into a Task and backfills the link, so nothing the user
// captured is lost when the new code starts reading taskId.
//
// Resolved/dropped rows are left alone: they either already produced a task or
// were deliberately discarded, and inventing tasks for them would resurrect
// work the user finished with.
//
//   npx tsx scripts/backfill-clarification-tasks.ts --dry-run
//   npx tsx scripts/backfill-clarification-tasks.ts
//
// Idempotent — re-running skips rows that already have a taskId.

// dotenv first: env() validates MONGODB_URI on its first call, and a script
// (unlike src/index.ts) has nothing else loading the .env file for it.
import 'dotenv/config'
import mongoose from 'mongoose'

import { env } from '../src/env'
import { Clarification } from '../src/models/Clarification'
import { Task } from '../src/models/Task'

const dryRun = process.argv.includes('--dry-run')

async function main(): Promise<void> {
  await mongoose.connect(env().MONGODB_URI)

  // Read through the driver: these rows predate the required field, so loading
  // them as hydrated documents would fail validation before we can fix them.
  const orphans = await Clarification.collection
    .find({ taskId: { $exists: false }, status: 'open' })
    .toArray()

  console.log(`${orphans.length} open clarification(s) with no task.`)
  if (dryRun) {
    for (const row of orphans) {
      const draft = row.draft as { title?: string; domain?: string; dueAt?: Date } | undefined
      console.log(`  would create: "${draft?.title}" (${draft?.domain}) due=${draft?.dueAt ?? '—'}`)
    }
    await mongoose.disconnect()
    return
  }

  let migrated = 0
  for (const row of orphans) {
    const draft = row.draft as {
      title: string
      domain: string
      priority?: string
      notes?: string
      tags?: string[]
      dueAt?: Date
    }
    // kind 'list' regardless of dueAt: these dates were never confirmed, and a
    // migration is the last place that should start firing reminders.
    const task = await Task.create({
      userId: row.userId,
      title: draft.title,
      domain: draft.domain,
      kind: 'list',
      priority: draft.priority ?? 'normal',
      tags: draft.tags ?? [],
      notes: draft.notes,
      dueAt: draft.dueAt,
      status: 'open',
    })
    await Clarification.collection.updateOne({ _id: row._id }, { $set: { taskId: task._id } })
    migrated += 1
  }

  console.log(`Backfilled ${migrated} clarification(s).`)
  await mongoose.disconnect()
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
