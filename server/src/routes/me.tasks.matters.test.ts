import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'

// The Matters surface: filtering, sorting, paging, counts, and — most
// importantly — that no multi-task operation is irreversible.

type Session = Awaited<ReturnType<typeof signUp>>

const create = (session: Session, body: Record<string, unknown>) =>
  request
    .post('/me/tasks')
    .set('Authorization', auth(session.accessToken))
    .send({ title: 'a matter', domain: 'home', ...body })

const list = (session: Session, query = '') =>
  request.get(`/me/tasks${query}`).set('Authorization', auth(session.accessToken))

const titles = (res: { body: { tasks: { title: string }[] } }) =>
  res.body.tasks.map((t) => t.title)

// Fixed instants so "overdue" and range assertions don't drift with the clock.
const PAST = '2020-01-01T09:00:00Z'
const FUTURE = '2099-01-01T09:00:00Z'

describe('GET /me/tasks — filters', () => {
  it('matches free text across title and notes, case-insensitively', async () => {
    const s = await signUp()
    await create(s, { title: 'Renew car Insurance' })
    await create(s, { title: 'Call the vet', notes: 'ask about insurance cover' })
    await create(s, { title: 'Buy milk' })

    expect(titles(await list(s, '?q=insurance')).sort()).toEqual([
      'Call the vet',
      'Renew car Insurance',
    ])
  })

  it('treats regex metacharacters in the query as literal text', async () => {
    const s = await signUp()
    await create(s, { title: 'Budget (2026)' })
    await create(s, { title: 'Budget 2026' })

    // An unescaped "(" would be a syntax error, not a search.
    const res = await list(s, `?q=${encodeURIComponent('(2026)')}`)
    expect(res.status).toBe(200)
    expect(titles(res)).toEqual(['Budget (2026)'])
  })

  it('accepts comma-separated multi-value filters as OR', async () => {
    const s = await signUp()
    await create(s, { title: 'car one', domain: 'car' })
    await create(s, { title: 'pets one', domain: 'pets' })
    await create(s, { title: 'home one', domain: 'home' })

    expect(titles(await list(s, '?domain=car,pets')).sort()).toEqual(['car one', 'pets one'])
  })

  it('rejects an unknown member of a multi-value filter rather than ignoring it', async () => {
    const s = await signUp()
    const res = await list(s, '?domain=car,spaceship')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_query')
  })

  it('rejects unknown query params (strict)', async () => {
    const s = await signUp()
    const res = await list(s, '?nonsense=1')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_query')
  })

  it('filters by kind', async () => {
    const s = await signUp()
    await create(s, { title: 'fires', dueAt: FUTURE })
    await create(s, { title: 'passive' })

    expect(titles(await list(s, '?kind=reminder'))).toEqual(['fires'])
    expect(titles(await list(s, '?kind=list'))).toEqual(['passive'])
  })

  it('overdue returns only past-due live tasks, never completed ones', async () => {
    const s = await signUp()
    await create(s, { title: 'late', dueAt: PAST })
    await create(s, { title: 'ahead', dueAt: FUTURE })
    await create(s, { title: 'undated' })
    const done = await create(s, { title: 'late but done', dueAt: PAST })
    await request
      .patch(`/me/tasks/${done.body.task.id}`)
      .set('Authorization', auth(s.accessToken))
      .send({ status: 'done' })

    expect(titles(await list(s, '?overdue=true'))).toEqual(['late'])
  })

  it('undated and untagged isolate the backlog', async () => {
    const s = await signUp()
    await create(s, { title: 'dated', dueAt: FUTURE, tags: ['admin'] })
    await create(s, { title: 'floating' })

    expect(titles(await list(s, '?undated=true'))).toEqual(['floating'])
    expect(titles(await list(s, '?untagged=true'))).toEqual(['floating'])
  })

  it('filters by tag, OR across several', async () => {
    const s = await signUp()
    await create(s, { title: 'trip', tags: ['travel'] })
    await create(s, { title: 'forms', tags: ['admin'] })
    await create(s, { title: 'other', tags: ['misc'] })

    expect(titles(await list(s, '?tag=travel,admin')).sort()).toEqual(['forms', 'trip'])
  })
})

describe('GET /me/tasks — sorting and paging', () => {
  it('sorts date-less matters LAST in both due directions', async () => {
    const s = await signUp()
    await create(s, { title: 'no-date' })
    await create(s, { title: 'soon', dueAt: '2026-01-01T09:00:00Z' })
    await create(s, { title: 'later', dueAt: '2027-01-01T09:00:00Z' })

    expect(titles(await list(s, '?sort=due-asc'))).toEqual(['soon', 'later', 'no-date'])
    expect(titles(await list(s, '?sort=due-desc'))).toEqual(['later', 'soon', 'no-date'])
  })

  it('sorts by priority, highest first', async () => {
    const s = await signUp()
    await create(s, { title: 'low one', priority: 'low' })
    await create(s, { title: 'urgent one', priority: 'urgent' })
    await create(s, { title: 'normal one', priority: 'normal' })

    expect(titles(await list(s, '?sort=priority-desc'))).toEqual([
      'urgent one',
      'normal one',
      'low one',
    ])
  })

  it('pages through the whole set with no duplicates and no gaps', async () => {
    const s = await signUp()
    for (let i = 0; i < 7; i += 1) {
      await create(s, { title: `t${i}`, dueAt: `202${i}-03-01T09:00:00Z` })
    }

    const seen: string[] = []
    let cursor: string | null = null
    let guard = 0
    do {
      const res: { body: { tasks: { title: string }[]; nextCursor: string | null; total: number } } =
        await list(s, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
      expect(res.body.total).toBe(7)
      seen.push(...res.body.tasks.map((t) => t.title))
      cursor = res.body.nextCursor
      guard += 1
    } while (cursor && guard < 10)

    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })
})

describe('GET /me/tasks/counts', () => {
  it('counts live buckets and excludes trashed matters', async () => {
    const s = await signUp()
    await create(s, { title: 'late', dueAt: PAST })
    await create(s, { title: 'ahead', dueAt: FUTURE })
    await create(s, { title: 'floating' })
    const doomed = await create(s, { title: 'doomed' })
    await request
      .delete(`/me/tasks/${doomed.body.task.id}`)
      .set('Authorization', auth(s.accessToken))

    const res = await request
      .get('/me/tasks/counts?tz=UTC')
      .set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.counts.overdue).toBe(1)
    expect(res.body.counts.later).toBe(1)
    expect(res.body.counts.undated).toBe(1)
    expect(res.body.counts.open).toBe(3)
    expect(res.body.counts.trashed).toBe(1)
    expect(res.body.counts.byDomain.home).toBe(3)
  })

  it('scopes counts to the caller', async () => {
    const a = await signUp()
    const b = await signUp()
    await create(a, { title: 'mine' })
    await create(b, { title: 'theirs' })

    const res = await request
      .get('/me/tasks/counts?tz=UTC')
      .set('Authorization', auth(a.accessToken))
    expect(res.body.counts.open).toBe(1)
  })
})

describe('POST /me/tasks/bulk', () => {
  const bulk = (s: Session, body: Record<string, unknown>) =>
    request.post('/me/tasks/bulk').set('Authorization', auth(s.accessToken)).send(body)

  const preview = (s: Session, body: Record<string, unknown>) =>
    request.post('/me/tasks/bulk/preview').set('Authorization', auth(s.accessToken)).send(body)

  it('preview count matches what apply actually affects', async () => {
    const s = await signUp()
    await create(s, { title: 'x', dueAt: '2026-02-01T09:00:00Z' })
    await create(s, { title: 'y', dueAt: '2026-02-15T09:00:00Z' })
    await create(s, { title: 'z', dueAt: '2027-02-01T09:00:00Z' })

    const range = {
      filter: { dueAfter: '2026-01-01T00:00:00Z', dueBefore: '2026-03-01T00:00:00Z' },
      action: 'delete',
    }
    const pre = await preview(s, range)
    expect(pre.body.count).toBe(2)
    expect(pre.body.sample).toHaveLength(2)

    const applied = await bulk(s, range)
    expect(applied.body.affected).toBe(2)
    expect(titles(await list(s))).toEqual(['z'])
  })

  it('surfaces ripple warnings so the confirm card can disclose them', async () => {
    const s = await signUp()
    await create(s, { title: 'plain' })

    const pre = await preview(s, { filter: {}, action: 'delete' })
    expect(pre.body.warnings).toMatchObject({
      fromDocuments: 0,
      remindersFired: 0,
      truncated: false,
    })
  })

  it('undoes a bulk delete, restoring every matter exactly', async () => {
    const s = await signUp()
    await create(s, { title: 'one' })
    await create(s, { title: 'two' })

    const res = await bulk(s, { filter: {}, action: 'delete' })
    expect(res.body.affected).toBe(2)
    expect(titles(await list(s))).toEqual([])

    const undo = await request
      .post(`/me/tasks/undo/${res.body.undoToken}`)
      .set('Authorization', auth(s.accessToken))
    expect(undo.body.restored).toBe(2)
    expect(titles(await list(s)).sort()).toEqual(['one', 'two'])
  })

  it('undoes a bulk snooze back to the exact prior state, unsetting absent fields', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'one' })
    expect(t.body.task.snoozedUntil).toBeUndefined()

    const res = await bulk(s, { ids: [t.body.task.id], action: 'snooze', until: FUTURE })
    expect(res.body.affected).toBe(1)

    const snoozed = await request
      .get(`/me/tasks/${t.body.task.id}`)
      .set('Authorization', auth(s.accessToken))
    expect(snoozed.body.task.status).toBe('snoozed')

    await request
      .post(`/me/tasks/undo/${res.body.undoToken}`)
      .set('Authorization', auth(s.accessToken))

    const restored = await request
      .get(`/me/tasks/${t.body.task.id}`)
      .set('Authorization', auth(s.accessToken))
    expect(restored.body.task.status).toBe('open')
    // Absent before the op, so it must be gone again — not left at its post-op value.
    expect(restored.body.task.snoozedUntil).toBeUndefined()
  })

  it('skips no-ops so undo cannot resurrect a change that never happened', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'already done' })
    await request
      .patch(`/me/tasks/${t.body.task.id}`)
      .set('Authorization', auth(s.accessToken))
      .send({ status: 'done' })

    const res = await bulk(s, { ids: [t.body.task.id], action: 'complete' })
    expect(res.body.affected).toBe(0)
    expect(res.body.undoToken).toBeNull()
  })

  it('merges tags without duplicating them', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'one', tags: ['travel'] })

    await bulk(s, { ids: [t.body.task.id], action: 'addTags', tags: ['Travel', 'admin'] })

    const after = await request
      .get(`/me/tasks/${t.body.task.id}`)
      .set('Authorization', auth(s.accessToken))
    expect(after.body.task.tags.sort()).toEqual(['admin', 'travel'])
  })

  it('never reaches another user\'s matters through a filter', async () => {
    const a = await signUp()
    const b = await signUp()
    await create(a, { title: 'mine' })
    await create(b, { title: 'theirs' })

    const res = await bulk(a, { filter: {}, action: 'delete' })
    expect(res.body.affected).toBe(1)
    expect(titles(await list(b))).toEqual(['theirs'])
  })

  it('requires exactly one of ids or filter', async () => {
    const s = await signUp()
    expect((await bulk(s, { action: 'delete' })).status).toBe(400)
    expect((await bulk(s, { ids: ['x'], filter: {}, action: 'delete' })).status).toBe(400)
  })
})

describe('Trash', () => {
  it('restores a single matter from trash', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'oops' })
    await request.delete(`/me/tasks/${t.body.task.id}`).set('Authorization', auth(s.accessToken))

    const res = await request
      .post(`/me/tasks/${t.body.task.id}/restore`)
      .set('Authorization', auth(s.accessToken))
    expect(res.status).toBe(200)
    expect(titles(await list(s))).toEqual(['oops'])
  })

  it('emptying trash purges only trashed matters, and only the caller\'s', async () => {
    const a = await signUp()
    const b = await signUp()
    const keep = await create(a, { title: 'keep' })
    const drop = await create(a, { title: 'drop' })
    const theirs = await create(b, { title: 'theirs' })
    await request.delete(`/me/tasks/${drop.body.task.id}`).set('Authorization', auth(a.accessToken))
    await request
      .delete(`/me/tasks/${theirs.body.task.id}`)
      .set('Authorization', auth(b.accessToken))

    const res = await request
      .delete('/me/tasks/trash')
      .set('Authorization', auth(a.accessToken))
    expect(res.body.purged).toBe(1)

    expect(titles(await list(a))).toEqual(['keep'])
    expect(keep.body.task.id).toBeTruthy()

    // The other user's trash is untouched and still restorable.
    const otherTrash = await request
      .get('/me/tasks/trash')
      .set('Authorization', auth(b.accessToken))
    expect(otherTrash.body.tasks).toHaveLength(1)
  })

  it('excludes trashed matters from the tag list', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'one', tags: ['ghost'] })
    await create(s, { title: 'two', tags: ['live'] })
    await request.delete(`/me/tasks/${t.body.task.id}`).set('Authorization', auth(s.accessToken))

    const res = await request
      .get('/me/tasks/tags')
      .set('Authorization', auth(s.accessToken))
    expect(res.body.tags).toEqual(['live'])
  })
})

describe('PATCH /me/tasks/:id — slip tracking', () => {
  it('counts pushes back but not pulls forward', async () => {
    const s = await signUp()
    const t = await create(s, { title: 'slippy', dueAt: '2026-06-01T09:00:00Z' })
    const patch = (dueAt: string) =>
      request
        .patch(`/me/tasks/${t.body.task.id}`)
        .set('Authorization', auth(s.accessToken))
        .send({ dueAt })

    await patch('2026-07-01T09:00:00Z') // pushed back  → counts
    await patch('2026-08-01T09:00:00Z') // pushed back  → counts
    const pulled = await patch('2026-05-01T09:00:00Z') // pulled forward → does not

    expect(pulled.body.task.rescheduleCount).toBe(2)
  })
})
