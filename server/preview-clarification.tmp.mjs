// Temporary preview row for /uncertainties, so the new "You said" quote can be
// seen rendering with real data. Marked with a known _id and removed by the
// `down` command right after the screenshot — nothing is left behind.
import mongoose from 'mongoose'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const PREVIEW_ID = new mongoose.Types.ObjectId('000000000000000000000042')

await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB || undefined })
const db = mongoose.connection.db
const clars = db.collection('clarifications')

const cmd = process.argv[2]

if (cmd === 'up') {
  const anchor = await clars.findOne({ status: 'open' })
  if (!anchor) throw new Error('no open clarification to borrow a userId/taskId from')
  await clars.deleteOne({ _id: PREVIEW_ID })
  await clars.insertOne({
    _id: PREVIEW_ID,
    userId: anchor.userId,
    taskId: anchor.taskId,
    status: 'open',
    draft: { title: 'Email that guy', domain: 'home', priority: 'normal', tags: [] },
    question: "What's the email to that guy about?",
    kind: 'detail',
    costOfWrong: 'high',
    options: [],
    sourceText:
      'Email that guy back about the quote — the one from last week, before he chases me again.',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  console.log('inserted preview row for user', String(anchor.userId))
} else {
  const res = await clars.deleteOne({ _id: PREVIEW_ID })
  console.log('removed preview rows:', res.deletedCount)
}

await mongoose.disconnect()
