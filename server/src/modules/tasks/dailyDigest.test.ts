import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { env } from '../../env'
import { Task } from '../../models/Task'
import { AiUsageCounter, utcDateBucket } from '../../models/AiUsageCounter'
import { Clarification } from '../../models/Clarification'
import { ScannedDocument } from '../../models/ScannedDocument'
import { DailyDigest } from '../../models/DailyDigest'
import { User } from '../../models/User'
import { buildDailyDigest, whenDigestProseSettled } from './dailyDigest'

// AI seam. The digest is contractually allowed to run without a model at all,
// so the default here is "not configured" — every counting test therefore also
// proves the no-AI path returns something usable.
let aiConfigured = false
const generateContent = vi.fn()

vi.mock('../ai/provider/geminiClient', () => ({
  isAiConfigured: () => aiConfigured,
  getGeminiClient: () => ({
    models: { generateContent: (...args: unknown[]) => generateContent(...(args as [])) },
  }),
  __resetGeminiClientForTests: () => {},
}))

// Fixed instant + fixed zone: every boundary in the digest is derived from the
// local midnight, so a floating "now" would make the expected counts drift.
const NOW = new Date('2026-07-27T12:00:00.000Z')
const TZ = 'UTC'
const DAY_MS = 86_400_000

let userId: string

beforeEach(() => {
  userId = new Types.ObjectId().toHexString()
})

afterEach(async () => {
  // The prose refresh is fire-and-forget in production. Drain it before
  // resetting the spy, or a call started by THIS test lands during the next one
  // and fails an assertion that has nothing to do with it.
  await whenDigestProseSettled()
  aiConfigured = false
  generateContent.mockReset()
})

async function task(over: Record<string, unknown> = {}) {
  return Task.create({
    userId: new Types.ObjectId(userId),
    title: 'Pay electricity bill',
    domain: 'home',
    ...over,
  })
}

function digest() {
  return buildDailyDigest({ userId, timezone: TZ, now: NOW })
}

describe('buildDailyDigest — counts', () => {
  it('computes every figure from real documents', async () => {
    await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T15:00:00.000Z') })
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    await task({ title: 'Call plumber', dueAt: new Date('2026-07-30T09:00:00.000Z') })
    await task({
      title: 'Filed accounts',
      status: 'done',
      completedAt: new Date('2026-07-27T08:00:00.000Z'),
    })
    // Overdue by a month — past the fortnight cutoff, so it is slipping.
    await task({ title: 'Renew passport', dueAt: new Date(NOW.getTime() - 30 * DAY_MS) })
    await Clarification.create({
      userId: new Types.ObjectId(userId),
      taskId: new Types.ObjectId(),
      status: 'open',
      draft: { title: 'Car insurance', domain: 'car', priority: 'normal', tags: [] },
      question: 'The 15th or the 18th?',
    })
    await ScannedDocument.create({
      userId: new Types.ObjectId(userId),
      storageKey: 'k',
      mimeType: 'application/pdf',
      pageCount: 1,
      byteSize: 10,
      status: 'ready_for_review',
      clientCapturedAt: NOW,
    })

    const result = await digest()

    expect(result.localDate).toBe('2026-07-27')
    expect(result.counts).toEqual({
      dueToday: 2,
      completedToday: 1,
      // Everything except the completed one.
      openTotal: 4,
      slipping: 1,
      needsInput: 1,
      scansAwaitingReview: 1,
    })
  })

  it('counts a matter moved three times as slipping even when it is not overdue', async () => {
    await task({ dueAt: new Date('2026-07-30T09:00:00.000Z'), rescheduleCount: 3 })

    const result = await digest()

    expect(result.counts.slipping).toBe(1)
    expect(result.counts.dueToday).toBe(0)
  })

  it('scopes every count to the caller', async () => {
    await task({ dueAt: new Date('2026-07-27T15:00:00.000Z') })
    await Task.create({
      userId: new Types.ObjectId(),
      title: 'Someone else’s bill',
      domain: 'home',
      dueAt: new Date('2026-07-27T15:00:00.000Z'),
    })

    const result = await digest()

    expect(result.counts.dueToday).toBe(1)
    expect(result.counts.openTotal).toBe(1)
  })

  it('ignores soft-deleted matters', async () => {
    await task({ dueAt: new Date('2026-07-27T15:00:00.000Z') })
    await task({ dueAt: new Date('2026-07-27T16:00:00.000Z'), deletedAt: new Date() })

    const result = await digest()

    expect(result.counts.dueToday).toBe(1)
    expect(result.counts.openTotal).toBe(1)
  })

  it('names the heaviest day in the week ahead and ignores overdue matters', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    await task({ dueAt: new Date('2026-07-30T09:00:00.000Z') })
    await task({ dueAt: new Date('2026-07-30T15:00:00.000Z') })
    await task({ dueAt: new Date(NOW.getTime() - 30 * DAY_MS) })

    const result = await digest()

    expect(result.busiestDay).toEqual({ date: '2026-07-30', count: 2 })
  })

  it('groups near-identical titles as duplicates', async () => {
    await task({ title: 'Pay electricity bill', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    await task({ title: '  pay   ELECTRICITY bill ', dueAt: new Date('2026-07-28T09:00:00.000Z') })
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-29T09:00:00.000Z') })

    const result = await digest()

    expect(result.duplicates).toHaveLength(1)
    expect(result.duplicates[0]?.count).toBe(2)
  })

  it('returns a usable digest for a user with nothing at all', async () => {
    const result = await digest()

    expect(result.counts.dueToday).toBe(0)
    expect(result.counts.openTotal).toBe(0)
    expect(result.busiestDay).toBeNull()
    expect(result.themes).toEqual([])
    expect(result.headline.length).toBeGreaterThan(0)
    expect(result.estimatedMinutesToday).toEqual({ min: 0, max: 0 })
  })

  it('falls back to UTC rather than throwing on an unusable timezone', async () => {
    await task({ dueAt: new Date('2026-07-27T15:00:00.000Z') })

    const result = await buildDailyDigest({ userId, timezone: 'Mars/Olympus', now: NOW })

    expect(result.localDate).toBe('2026-07-27')
    expect(result.counts.dueToday).toBe(1)
  })

  it('reads the local day through the caller’s zone, not UTC', async () => {
    // 22:00 in Los Angeles on the 26th is 05:00 UTC on the 27th.
    const at = new Date('2026-07-27T05:00:00.000Z')
    const result = await buildDailyDigest({ userId, timezone: 'America/Los_Angeles', now: at })

    expect(result.localDate).toBe('2026-07-26')
  })
})

describe('buildDailyDigest — estimates', () => {
  // `estimate` is workstream A's field and may not be on the schema yet, so it
  // is written straight to the collection. That is exactly the shape the
  // defensive read has to survive.
  async function setEstimate(id: Types.ObjectId, minMinutes: number, maxMinutes: number) {
    await Task.collection.updateOne(
      { _id: id },
      { $set: { estimate: { minMinutes, maxMinutes, source: 'ai' } } },
    )
  }

  it('sums today’s estimates and treats an unestimated matter as zero', async () => {
    const a = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const b = await task({ dueAt: new Date('2026-07-27T11:00:00.000Z') })
    await task({ dueAt: new Date('2026-07-27T13:00:00.000Z') })
    await setEstimate(a._id, 15, 30)
    await setEstimate(b._id, 5, 5)

    const result = await digest()

    expect(result.estimatedMinutesToday).toEqual({ min: 20, max: 35 })
  })

  it('ignores estimates on matters that are not due today', async () => {
    const later = await task({ dueAt: new Date('2026-07-30T09:00:00.000Z') })
    await setEstimate(later._id, 60, 90)

    const result = await digest()

    expect(result.estimatedMinutesToday).toEqual({ min: 0, max: 0 })
  })

  it('skips a malformed estimate instead of poisoning the total', async () => {
    const a = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const b = await task({ dueAt: new Date('2026-07-27T10:00:00.000Z') })
    await Task.collection.updateOne({ _id: a._id }, { $set: { estimate: { minMinutes: 'ten' } } })
    await setEstimate(b._id, 10, 10)

    const result = await digest()

    expect(result.estimatedMinutesToday).toEqual({ min: 10, max: 10 })
  })
})

describe('buildDailyDigest — caching', () => {
  it('serves the cached row while the matter state is unchanged', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })

    const first = await digest()
    // Same local day, an hour later: the cache must answer rather than rebuild.
    const second = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(second.generatedAt).toBe(first.generatedAt)
    expect(await DailyDigest.countDocuments({})).toBe(1)
  })

  it('rebuilds when a matter changes the source hash', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const first = await digest()

    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T11:00:00.000Z') })
    const second = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(first.counts.dueToday).toBe(1)
    expect(second.counts.dueToday).toBe(2)
    expect(second.generatedAt).not.toBe(first.generatedAt)
    // Still one row — the rebuild replaces the day's entry, it does not stack.
    expect(await DailyDigest.countDocuments({})).toBe(1)
  })

  it('rebuilds when the language changes, though no matter moved', async () => {
    // The failure this prevents: switching to Arabic changes what the row should
    // say without touching a single matter, so every other input to the
    // fingerprint is identical and the English sentence would be served all day.
    await User.create({ _id: new Types.ObjectId(userId), email: 'ar@example.com' })
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })

    const first = await digest()
    await User.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { locale: 'ar' } })
    const second = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(second.generatedAt).not.toBe(first.generatedAt)
    expect(await DailyDigest.countDocuments({})).toBe(1)
    const row = await DailyDigest.findOne({}).lean()
    expect(row?.locale).toBe('ar')
  })

  it('drops carried-forward themes when the language changes', async () => {
    // Themes deliberately survive a rebuild so the strip does not empty out. In
    // the language the user just left they are not stale wording, they are wrong
    // — and they would sit directly under a headline that already switched.
    await User.create({ _id: new Types.ObjectId(userId), email: 'themes@example.com' })
    const matter = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })

    await digest()
    await DailyDigest.updateOne(
      {},
      {
        $set: {
          'payload.themes': [
            { label: 'Car paperwork', count: 1, taskIds: [String(matter._id)] },
          ],
        },
      },
    )

    await User.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { locale: 'ar' } })
    const switched = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(switched.themes).toEqual([])
  })

  it('keeps carried-forward themes when the language is unchanged', async () => {
    await User.create({ _id: new Types.ObjectId(userId), email: 'keep@example.com' })
    const matter = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })

    await digest()
    await DailyDigest.updateOne(
      {},
      {
        $set: {
          'payload.themes': [
            { label: 'Car paperwork', count: 1, taskIds: [String(matter._id)] },
          ],
        },
      },
    )

    // A real change to the matters, so the row rebuilds for a reason unrelated to
    // language — the themes must ride along.
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T11:00:00.000Z') })
    const rebuilt = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 3_600_000),
    })

    expect(rebuilt.themes.map((theme) => theme.label)).toEqual(['Car paperwork'])
  })

  it('rebuilds when an unrelated collection changes', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const first = await digest()

    await ScannedDocument.create({
      userId: new Types.ObjectId(userId),
      storageKey: 'k',
      mimeType: 'application/pdf',
      pageCount: 1,
      byteSize: 10,
      status: 'ready_for_review',
      clientCapturedAt: NOW,
    })
    const second = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 60_000),
    })

    expect(first.counts.scansAwaitingReview).toBe(0)
    expect(second.counts.scansAwaitingReview).toBe(1)
  })

  it('rebuilds on a new local day even with identical matters', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const first = await digest()

    const tomorrow = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + DAY_MS),
    })

    expect(first.localDate).toBe('2026-07-27')
    expect(tomorrow.localDate).toBe('2026-07-28')
    expect(await DailyDigest.countDocuments({})).toBe(2)
  })

  it('keeps one cache row per user', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    await digest()
    await buildDailyDigest({ userId: new Types.ObjectId().toHexString(), timezone: TZ, now: NOW })

    expect(await DailyDigest.countDocuments({})).toBe(2)
  })
})

describe('buildDailyDigest — the written half', () => {
  function modelReturns(body: unknown) {
    generateContent.mockResolvedValue({ text: JSON.stringify(body) })
  }

  // The model's sentence arrives one read LATE, by design: the first build ships
  // the computed headline immediately rather than holding every count hostage to
  // a language model (see dailyDigest.ts). So the written half is asserted the
  // way the dashboard actually receives it — build, let the background write
  // land, read again.
  async function digestAfterProse() {
    await digest()
    await whenDigestProseSettled()
    return digest()
  }

  it('takes the headline and theme labels from the model', async () => {
    const a = await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    const b = await task({ title: 'Car service', dueAt: new Date('2026-07-28T09:00:00.000Z') })
    aiConfigured = true
    modelReturns({
      headline: 'Today is mostly car paperwork.',
      themes: [{ label: 'Car paperwork', taskIds: [String(a._id), String(b._id)] }],
    })

    const result = await digestAfterProse()

    expect(result.headline).toBe('Today is mostly car paperwork.')
    expect(result.themes).toEqual([
      { label: 'Car paperwork', count: 2, taskIds: [String(a._id), String(b._id)] },
    ])
    // The figures are still ours, not the model's.
    expect(result.counts.dueToday).toBe(1)
  })

  it('ships the computed headline first and upgrades it in the background', async () => {
    await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    modelReturns({ headline: 'Today is mostly car paperwork.', themes: [] })

    // The read the user actually waits on never touches the model.
    const first = await digest()
    expect(first.headline).toBe('1 matter due today.')

    await whenDigestProseSettled()
    expect((await digest()).headline).toBe('Today is mostly car paperwork.')
  })

  it('discards prose that resolves after the matters moved on', async () => {
    await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true

    // Hold the model's answer open so it can be made to land AFTER the rebuild —
    // the race the sourceHash guard exists for. A mock that resolves immediately
    // would win before the rebuild and never exercise it.
    let release!: () => void
    generateContent.mockReturnValue(
      new Promise((resolve) => {
        release = () =>
          resolve({ text: JSON.stringify({ headline: 'Sentence about one matter.', themes: [] }) })
      }),
    )

    await digest()

    // A second matter lands, so the row is rewritten against a new fingerprint.
    // The model goes away for the rebuild, so nothing competes with the answer
    // still in flight for the OLD state.
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T11:00:00.000Z') })
    aiConfigured = false
    await digest()

    release()
    await whenDigestProseSettled()

    // The late sentence described one matter; there are now two. It is dropped
    // rather than stapled onto counts it does not match.
    expect((await digest()).headline).toBe('2 matters due today.')
  })

  it('drops theme ids the model was never given', async () => {
    const a = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    modelReturns({
      headline: 'A quiet day.',
      themes: [
        { label: 'Real', taskIds: [String(a._id)] },
        { label: 'Invented', taskIds: [new Types.ObjectId().toHexString()] },
      ],
    })

    const result = await digestAfterProse()

    expect(result.themes).toHaveLength(1)
    expect(result.themes[0]?.label).toBe('Real')
  })

  it('strips a raw id the model smuggled into the headline', async () => {
    const a = await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    modelReturns({
      headline: `Several copies of "Pay electricity bill" (e.g., ${String(a._id)}) are due today.`,
      themes: [],
    })

    const result = await digestAfterProse()

    expect(result.headline).not.toContain(String(a._id))
    expect(result.headline).toContain('Pay electricity bill')
  })

  it('never asks the model anything when there is nothing to describe', async () => {
    aiConfigured = true
    modelReturns({ headline: 'should not be used', themes: [] })

    const result = await digest()

    expect(generateContent).not.toHaveBeenCalled()
    expect(result.headline).toBe('Nothing on today.')
  })
})

describe('buildDailyDigest — resilience', () => {
  it('returns real counts with a computed headline when the model throws', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T11:00:00.000Z') })
    aiConfigured = true
    generateContent.mockRejectedValue(new Error('gemini exploded'))

    const result = await digest()

    expect(result.counts.dueToday).toBe(2)
    expect(result.headline).toBe('2 matters due today.')
    expect(result.themes).toEqual([])
  })

  it('returns real counts when the model answers with unparseable text', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockResolvedValue({ text: 'not json at all' })

    const result = await digest()

    expect(result.counts.dueToday).toBe(1)
    expect(result.headline).toBe('1 matter due today.')
  })

  it('returns real counts when the model answers with the wrong shape', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockResolvedValue({ text: JSON.stringify({ themes: 'nope' }) })

    const result = await digest()

    expect(result.counts.dueToday).toBe(1)
    expect(result.headline).toBe('1 matter due today.')
  })

  it('returns real counts when the daily AI allowance is already spent', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockResolvedValue({ text: JSON.stringify({ headline: 'nope', themes: [] }) })
    // Park the counter on the limit so admission is refused.
    await AiUsageCounter.updateOne(
      { userId: new Types.ObjectId(userId), date: utcDateBucket(), kind: 'message' },
      { $set: { count: env().AI_QUOTA_FREE_DAILY } },
      { upsert: true },
    )

    const result = await digest()

    expect(generateContent).not.toHaveBeenCalled()
    expect(result.counts.dueToday).toBe(1)
    expect(result.headline).toBe('1 matter due today.')
  })

  it('refunds the quota slot when the model fails after admission', async () => {
    await task({ dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockRejectedValue(new Error('gemini exploded'))

    await digest()
    // Admission and refund both happen on the background refresh now, so the
    // slot is still held the instant the digest returns.
    await whenDigestProseSettled()

    const row = await AiUsageCounter.findOne({
      userId: new Types.ObjectId(userId),
      kind: 'message',
    }).lean()
    expect(row?.count ?? 0).toBe(0)
  })

  it('keeps the previous themes when the model becomes unavailable mid-day', async () => {
    const a = await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        headline: 'Today is mostly car paperwork.',
        themes: [{ label: 'Car paperwork', taskIds: [String(a._id)] }],
      }),
    })
    await digest()
    // The themes only reach the cache row once the background write lands.
    await whenDigestProseSettled()

    // The matters move, forcing a rebuild — but now the model is down.
    await task({ title: 'Book dentist', dueAt: new Date('2026-07-27T11:00:00.000Z') })
    generateContent.mockRejectedValue(new Error('gemini exploded'))
    const rebuilt = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 60_000),
    })

    expect(rebuilt.themes).toEqual([
      { label: 'Car paperwork', count: 1, taskIds: [String(a._id)] },
    ])
    // The headline is NOT carried over — a sentence about an older state
    // presented as today would be a lie, where a plain count is merely plain.
    expect(rebuilt.headline).toBe('2 matters due today.')
  })

  it('drops carried-over themes whose matters have gone', async () => {
    const a = await task({ title: 'Renew road tax', dueAt: new Date('2026-07-27T09:00:00.000Z') })
    aiConfigured = true
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        headline: 'Car paperwork day.',
        themes: [{ label: 'Car paperwork', taskIds: [String(a._id)] }],
      }),
    })
    await digest()

    await Task.deleteOne({ _id: a._id })
    generateContent.mockRejectedValue(new Error('gemini exploded'))
    const rebuilt = await buildDailyDigest({
      userId,
      timezone: TZ,
      now: new Date(NOW.getTime() + 60_000),
    })

    expect(rebuilt.themes).toEqual([])
  })
})
