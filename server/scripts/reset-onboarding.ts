// One-off: reset a user's onboarding so the flow can be re-tested.
// Usage: tsx scripts/reset-onboarding.ts <email>
import { connectDb, disconnectDb } from '../src/db'
import { User } from '../src/models/User'

async function main() {
  const email = (process.argv[2] ?? '').toLowerCase().trim()
  if (!email) {
    console.error('Usage: tsx scripts/reset-onboarding.ts <email>')
    process.exit(1)
  }

  await connectDb()
  const res = await User.updateOne(
    { email },
    {
      $set: { hasOnboarded: false, onboardingAnswers: [], displayName: undefined },
    },
  )

  if (res.matchedCount === 0) {
    console.error(`No user found for ${email}`)
  } else {
    console.log(`Reset onboarding for ${email} (modified=${res.modifiedCount})`)
  }

  await disconnectDb()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
