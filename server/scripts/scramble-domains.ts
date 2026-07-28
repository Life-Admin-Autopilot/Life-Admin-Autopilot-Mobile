// Dev-only: misfile some matters so the categorize pass has something to find.
//
//   npx tsx scripts/scramble-domains.ts <email> [count]
//   npx tsx scripts/scramble-domains.ts <email> --restore
//
// The seeded dataset assigns every domain from a hand-written template, so a
// categorize run against it correctly proposes almost nothing — which makes it
// impossible to see the feature work. This reassigns N live matters to a
// deliberately wrong domain, recording the original in a tag so the change can
// be undone exactly.

import 'dotenv/config'
import { connectDb, disconnectDb } from '../src/db'
import { User } from '../src/models/User'
import { Task, notDeleted } from '../src/models/Task'
import { DOMAINS, type Domain } from '../src/models/User'

// The original domain rides along as a tag rather than a side file: it travels
// with the row, survives a restart, and makes a half-finished scramble obvious
// in the UI instead of silently permanent.
const MARK = 'was-'

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').toLowerCase().trim()
  const restore = process.argv.includes('--restore')
  const count = Number(process.argv[3] ?? 25)

  if (!email) {
    console.error('Usage: tsx scripts/scramble-domains.ts <email> [count] [--restore]')
    process.exit(1)
  }

  await connectDb()
  const user = await User.findOne({ email }).lean()
  if (!user) {
    console.error(`No user for ${email}`)
    await disconnectDb()
    process.exit(1)
  }
  const userId = user._id

  if (restore) {
    const marked = await Task.find({ userId, tags: { $regex: `^${MARK}` } })
    let restored = 0
    for (const task of marked) {
      const mark = task.tags.find((t) => t.startsWith(MARK))
      const original = mark?.slice(MARK.length) as Domain | undefined
      if (!original || !DOMAINS.includes(original)) continue
      task.domain = original
      task.set('tags', task.tags.filter((t) => !t.startsWith(MARK)))
      await task.save()
      restored += 1
    }
    console.log(`Restored ${restored} matters to their original domain.`)
    await disconnectDb()
    return
  }

  const candidates = await Task.find({
    userId,
    ...notDeleted(),
    status: { $in: ['open', 'snoozed'] },
    tags: { $not: { $regex: `^${MARK}` } },
  }).limit(count)

  let scrambled = 0
  for (const task of candidates) {
    const wrong = DOMAINS.filter((d) => d !== task.domain)
    const next = wrong[Math.floor(Math.random() * wrong.length)]!
    console.log(`  ${task.title.slice(0, 46).padEnd(48)} ${task.domain} → ${next}`)
    task.set('tags', [...task.tags, `${MARK}${task.domain}`].slice(0, 10))
    task.domain = next
    await task.save()
    scrambled += 1
  }

  console.log(`\nMisfiled ${scrambled} matters. Undo with --restore.`)
  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
