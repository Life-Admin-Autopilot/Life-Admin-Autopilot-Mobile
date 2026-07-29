import mongoose from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IcsFeed } from '../../../models/IcsFeed'
import { Task } from '../../../models/Task'
import type { FetchFeedResult } from './fetchFeed'

// syncFeed reaches the network through fetchFeed; everything else is real.
const fetchFeedMock = vi.hoisted(() => vi.fn<() => Promise<FetchFeedResult>>())
vi.mock('./fetchFeed', () => ({ fetchFeed: fetchFeedMock }))

// eslint-disable-next-line import/first -- must follow the hoisted vi.mock above
import { syncFeed } from './syncFeed'

const CTX = { timezone: 'Europe/London', defaultTimeOfDay: '09:00' }

function calendar(...veventLines: string[][]): string {
  const body = veventLines.flatMap((lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'])
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//EN', ...body, 'END:VCALENDAR'].join(
    '\r\n',
  )
}

function ok(body: string, etag = 'v1'): FetchFeedResult {
  return { status: 'ok', body, etag }
}

async function makeFeed(url = 'https://school.example/terms.ics') {
  return IcsFeed.create({
    userId: new mongoose.Types.ObjectId(),
    url,
    label: 'School terms',
    domain: 'family',
    status: 'active',
    failureCount: 0,
  })
}

// Dates must sit inside syncFeed's own window (now-7d .. now+365d), so they are
// derived from the clock rather than hardcoded — a fixed far-future date would
// be silently filtered out and every assertion would fail for the wrong reason.
function futureUtc(daysAhead: number, hour: number): { stamp: string; local: string; iso: string } {
  const at = new Date(Date.now() + daysAhead * 86_400_000)
  at.setUTCHours(hour, 0, 0, 0)
  const p = (n: number): string => String(n).padStart(2, '0')
  const ymd = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}`
  const hm = `${p(at.getUTCHours())}${p(at.getUTCMinutes())}00`
  return { stamp: `${ymd}T${hm}Z`, local: `${ymd}T${hm}`, iso: at.toISOString() }
}

const SOON = futureUtc(30, 9)
const LATER = futureUtc(31, 14)

beforeEach(() => {
  fetchFeedMock.mockReset()
})

describe('syncFeed — creating matters', () => {
  it('files each occurrence with the feed domain and its provenance', async () => {
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue(
      ok(calendar(['UID:a', `DTSTART:${SOON.stamp}`, 'SUMMARY:Term starts'])),
    )

    const result = await syncFeed(feed, CTX)

    expect(result.status).toBe('synced')
    expect(result.created).toBe(1)

    const task = await Task.findOne({ userId: feed.userId })
    expect(task?.title).toBe('Term starts')
    expect(task?.domain).toBe('family')
    expect(task?.externalSource).toBe('ics_feed')
    expect(task?.timePrecision).toBe('exact')
    expect(task?.kind).toBe('reminder')
  })

  it('files an ambiguous time as a passive list item that cannot fire', async () => {
    // A floating DTSTART could belong to any zone. principles.md says ask rather
    // than guess — so it appears, but it must never nudge on a coin flip.
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue(
      ok(calendar(['UID:f', `DTSTART:${SOON.local}`, 'SUMMARY:Club'])),
    )

    const result = await syncFeed(feed, CTX)

    expect(result.needingConfirmation).toBe(1)
    const task = await Task.findOne({ userId: feed.userId })
    expect(task?.kind).toBe('list')
    expect(task?.confidence).toBe('low')
    expect(task?.timePrecision).toBe('floating')
    expect(task?.reminders).toHaveLength(0)
  })
})

describe('syncFeed — repeated polls', () => {
  it('is idempotent: the same feed twice yields one matter', async () => {
    // ICS has no push, so we re-read an overlapping window every poll. Without
    // the upsert this is how one assembly becomes a matter every hour.
    const feed = await makeFeed()
    const body = calendar(['UID:a', `DTSTART:${SOON.stamp}`, 'SUMMARY:Term starts'])
    fetchFeedMock.mockResolvedValue(ok(body))

    await syncFeed(feed, CTX)
    const second = await syncFeed(feed, CTX)

    expect(second.created).toBe(0)
    expect(await Task.countDocuments({ userId: feed.userId })).toBe(1)
  })

  it('writes nothing on a 304 and clears a previous failure', async () => {
    const feed = await makeFeed()
    feed.status = 'error'
    feed.failureCount = 3
    feed.lastError = 'boom'
    await feed.save()

    fetchFeedMock.mockResolvedValue({ status: 'unchanged' })
    const result = await syncFeed(feed, CTX)

    expect(result.status).toBe('unchanged')
    expect(await Task.countDocuments({ userId: feed.userId })).toBe(0)
    expect(feed.status).toBe('active')
    expect(feed.failureCount).toBe(0)
    expect(feed.lastError).toBeUndefined()
  })

  it('updates the time when an event moves', async () => {
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue(ok(calendar(['UID:a', `DTSTART:${SOON.stamp}`, 'SUMMARY:Assembly'])))
    await syncFeed(feed, CTX)

    fetchFeedMock.mockResolvedValue(
      ok(calendar(['UID:a', `DTSTART:${LATER.stamp}`, 'SUMMARY:Assembly']), 'v2'),
    )
    const result = await syncFeed(feed, CTX)

    expect(result.updated).toBe(1)
    const task = await Task.findOne({ userId: feed.userId })
    expect(task?.dueAt?.toISOString()).toBe(LATER.iso)
  })
})

describe('syncFeed — respecting the user', () => {
  it('does not resurrect a matter the user deleted', async () => {
    // Task soft-deletes. A poll that ignored deletedAt would bring back
    // everything the user swept away, every hour, forever.
    const feed = await makeFeed()
    const body = calendar(['UID:a', `DTSTART:${SOON.stamp}`, 'SUMMARY:Assembly'])
    fetchFeedMock.mockResolvedValue(ok(body))
    await syncFeed(feed, CTX)

    const task = await Task.findOne({ userId: feed.userId })
    task!.deletedAt = new Date()
    await task!.save()

    const result = await syncFeed(feed, CTX)

    expect(result.created).toBe(0)
    const after = await Task.findById(task!._id)
    expect(after?.deletedAt).toBeTruthy()
  })

  it('keeps a title the user renamed', async () => {
    // The feed is authoritative for WHEN, the user for WHAT. Rewriting the title
    // on every poll would silently undo "rename this to something I understand".
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue(ok(calendar(['UID:a', `DTSTART:${SOON.stamp}`, 'SUMMARY:INSET'])))
    await syncFeed(feed, CTX)

    const task = await Task.findOne({ userId: feed.userId })
    task!.title = 'No school — arrange childcare'
    await task!.save()

    fetchFeedMock.mockResolvedValue(
      ok(calendar(['UID:a', `DTSTART:${LATER.stamp}`, 'SUMMARY:INSET']), 'v2'),
    )
    await syncFeed(feed, CTX)

    const after = await Task.findById(task!._id)
    expect(after?.title).toBe('No school — arrange childcare')
    // ...but the time still tracks the feed.
    expect(after?.dueAt?.toISOString()).toBe(LATER.iso)
  })
})

describe('syncFeed — failures', () => {
  it('marks a retired feed gone so the user is told', async () => {
    // A feed frozen in place looks identical to a feed with nothing on it, and
    // the user would go on trusting reminders that stopped arriving.
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue({ status: 'gone', reason: 'That feed no longer exists.' })

    const result = await syncFeed(feed, CTX)

    expect(result.status).toBe('gone')
    expect(feed.status).toBe('gone')
    expect(feed.lastError).toBe('That feed no longer exists.')
  })

  it('counts consecutive errors for backoff', async () => {
    const feed = await makeFeed()
    fetchFeedMock.mockResolvedValue({ status: 'error', reason: 'unreachable' })

    await syncFeed(feed, CTX)
    await syncFeed(feed, CTX)

    expect(feed.failureCount).toBe(2)
    expect(feed.status).toBe('error')
  })
})

describe('syncFeed — feed isolation', () => {
  it('does not let two feeds sharing a UID collide', async () => {
    // UIDs are only required to be unique within a calendar, so two councils can
    // and do both ship "1". Unnamespaced they would collide on the unique index
    // and one feed would silently overwrite the other.
    const userId = new mongoose.Types.ObjectId()
    const first = await IcsFeed.create({
      userId,
      url: 'https://a.example/a.ics',
      label: 'A',
      domain: 'family',
      status: 'active',
      failureCount: 0,
    })
    const second = await IcsFeed.create({
      userId,
      url: 'https://b.example/b.ics',
      label: 'B',
      domain: 'home',
      status: 'active',
      failureCount: 0,
    })

    fetchFeedMock.mockResolvedValue(ok(calendar(['UID:1', `DTSTART:${SOON.stamp}`, 'SUMMARY:From A'])))
    await syncFeed(first, CTX)

    fetchFeedMock.mockResolvedValue(ok(calendar(['UID:1', `DTSTART:${SOON.stamp}`, 'SUMMARY:From B'])))
    const result = await syncFeed(second, CTX)

    expect(result.created).toBe(1)
    expect(await Task.countDocuments({ userId })).toBe(2)
  })
})
