// One-off: backfill `kind` on existing tasks created before the
// reminder-vs-list split. A dated task fires (reminder); a dateless one is a
// passive list item. Idempotent — only touches rows missing `kind`.
// Usage: tsx scripts/backfill-task-kind.ts
import { connectDb, disconnectDb } from '../src/db'
import { Task } from '../src/models/Task'

async function main() {
  await connectDb()

  const dated = await Task.updateMany(
    { kind: { $exists: false }, dueAt: { $ne: null } },
    { $set: { kind: 'reminder' } },
  )
  const dateless = await Task.updateMany(
    { kind: { $exists: false } },
    { $set: { kind: 'list' } },
  )

  console.log(
    `Backfilled kind — reminder=${dated.modifiedCount}, list=${dateless.modifiedCount}`,
  )

  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
