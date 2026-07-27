import { describe, expect, it } from 'vitest'
import { auth, request, signUp } from '../test/helpers'

const taskPayload = (overrides: Record<string, unknown> = {}) => ({
  title: 'Renew car insurance',
  domain: 'car',
  ...overrides,
})

describe('POST /me/tasks', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request.post('/me/tasks').send(taskPayload())
    expect(res.status).toBe(401)
  })

  it('rejects invalid domain', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send({ title: 'do thing', domain: 'spaceship' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('invalid_body')
  })

  it('rejects unknown fields (strict schema)', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send({ ...taskPayload(), userId: 'attacker-id' })
    expect(res.status).toBe(400)
  })

  it('creates a task and defaults status to open', async () => {
    const session = await signUp()
    const res = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ dueAt: new Date('2026-06-01T09:00:00Z').toISOString(), notes: 'before holiday' }))
    expect(res.status).toBe(201)
    expect(res.body.task.title).toBe('Renew car insurance')
    expect(res.body.task.domain).toBe('car')
    expect(res.body.task.status).toBe('open')
    expect(res.body.task.notes).toBe('before holiday')
    expect(res.body.task.id).toBeTruthy()
  })
})

describe('GET /me/tasks', () => {
  it('returns only the caller\'s tasks', async () => {
    const a = await signUp()
    const b = await signUp()

    await request
      .post('/me/tasks')
      .set('Authorization', auth(a.accessToken))
      .send(taskPayload({ title: 'A-task' }))
    await request
      .post('/me/tasks')
      .set('Authorization', auth(b.accessToken))
      .send(taskPayload({ title: 'B-task' }))

    const res = await request
      .get('/me/tasks')
      .set('Authorization', auth(a.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.tasks).toHaveLength(1)
    expect(res.body.tasks[0].title).toBe('A-task')
  })

  it('filters by status and domain', async () => {
    const session = await signUp()
    await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ title: 'open-car', domain: 'car' }))
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ title: 'done-home', domain: 'home' }))
    await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ status: 'done' })

    const open = await request
      .get('/me/tasks?status=open')
      .set('Authorization', auth(session.accessToken))
    expect(open.body.tasks.map((t: { title: string }) => t.title)).toEqual(['open-car'])

    const home = await request
      .get('/me/tasks?domain=home')
      .set('Authorization', auth(session.accessToken))
    expect(home.body.tasks.map((t: { title: string }) => t.title)).toEqual(['done-home'])
  })

  it('filters by dueBefore', async () => {
    const session = await signUp()
    await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ title: 'past', dueAt: '2026-01-01T00:00:00Z' }))
    await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ title: 'future', dueAt: '2027-01-01T00:00:00Z' }))

    const res = await request
      .get('/me/tasks?dueBefore=2026-06-01T00:00:00Z')
      .set('Authorization', auth(session.accessToken))
    expect(res.body.tasks.map((t: { title: string }) => t.title)).toEqual(['past'])
  })
})

describe('PATCH /me/tasks/:id', () => {
  it('marks a task done and sets completedAt', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())

    const res = await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ status: 'done' })
    expect(res.status).toBe(200)
    expect(res.body.task.status).toBe('done')
    expect(res.body.task.completedAt).toBeTruthy()
  })

  it('clears completedAt when reopening', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())
    await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ status: 'done' })
    const reopen = await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ status: 'open' })
    expect(reopen.body.task.status).toBe('open')
    expect(reopen.body.task.completedAt).toBeUndefined()
  })

  it('returns 404 for another user\'s task', async () => {
    const a = await signUp()
    const b = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(a.accessToken))
      .send(taskPayload())

    const res = await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(b.accessToken))
      .send({ status: 'done' })
    expect(res.status).toBe(404)
  })

  it('clears notes when null is sent', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({ notes: 'temp' }))
    const res = await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ notes: null })
    expect(res.body.task.notes).toBeUndefined()
  })

  // Regression: this is exactly what the edit sheet sends when the user
  // edits a task that has no notes and picks "Keep current" due date.
  it('handles the sheet-edit payload shape: title + domain + null notes', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload({
        title: 'Renew car insurance',
        domain: 'car',
        dueAt: '2026-06-01T09:00:00Z',
      }))

    const res = await request
      .patch(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({
        title: 'Renew car',
        domain: 'home',
        notes: null,
      })

    expect(res.status).toBe(200)
    expect(res.body.task.title).toBe('Renew car')
    expect(res.body.task.domain).toBe('home')
    expect(res.body.task.notes).toBeUndefined()
    // dueAt was omitted from the body — must be preserved.
    expect(res.body.task.dueAt).toBe('2026-06-01T09:00:00.000Z')
  })
})

describe('DELETE /me/tasks/:id', () => {
  it('soft-deletes the caller\'s task and hands back an undo token', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())

    const res = await request
      .delete(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
    expect(res.status).toBe(200)
    expect(res.body.undoToken).toBeTruthy()

    // Gone from every live surface...
    const after = await request
      .get(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
    expect(after.status).toBe(404)

    const list = await request
      .get('/me/tasks')
      .set('Authorization', auth(session.accessToken))
    expect(list.body.tasks).toHaveLength(0)

    // ...but recoverable, which is the whole point of soft delete.
    const trash = await request
      .get('/me/tasks/trash')
      .set('Authorization', auth(session.accessToken))
    expect(trash.body.tasks).toHaveLength(1)
  })

  it('undo restores a deleted task, and undoing twice is a no-op', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())

    const del = await request
      .delete(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))

    const undo = await request
      .post(`/me/tasks/undo/${del.body.undoToken}`)
      .set('Authorization', auth(session.accessToken))
    expect(undo.status).toBe(200)
    expect(undo.body.restored).toBe(1)

    const after = await request
      .get(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(session.accessToken))
    expect(after.status).toBe(200)

    // A double-tapped undo toast must not surface an error.
    const again = await request
      .post(`/me/tasks/undo/${del.body.undoToken}`)
      .set('Authorization', auth(session.accessToken))
    expect(again.status).toBe(200)
    expect(again.body.restored).toBe(0)
  })

  it('will not let one user undo another user\'s delete', async () => {
    const a = await signUp()
    const b = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(a.accessToken))
      .send(taskPayload())
    const del = await request
      .delete(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(a.accessToken))

    const res = await request
      .post(`/me/tasks/undo/${del.body.undoToken}`)
      .set('Authorization', auth(b.accessToken))
    expect(res.status).toBe(404)
  })

  it('returns 404 across users', async () => {
    const a = await signUp()
    const b = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(a.accessToken))
      .send(taskPayload())

    const res = await request
      .delete(`/me/tasks/${created.body.task.id}`)
      .set('Authorization', auth(b.accessToken))
    expect(res.status).toBe(404)
  })
})

describe('subtasks', () => {
  // Regression: subtasks are Mongoose subdocuments, and the parent schema's
  // toJSON transform does NOT recurse into them. Without a transform on the
  // subtask schema they serialize as `_id` with no `id`, which made the editor
  // render `key={undefined}` ("unique key" warning) and send `subtaskId=undefined`
  // on toggle/delete ("subtask not found").
  it('round-trips a subtask with a string id (no _id leaked)', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())
    const taskId = created.body.task.id

    const added = await request
      .post(`/me/tasks/${taskId}/subtasks`)
      .set('Authorization', auth(session.accessToken))
      .send({ text: 'Call the garage' })
    expect(added.status).toBe(201)
    const [sub] = added.body.task.subtasks
    expect(typeof sub.id).toBe('string')
    expect(sub.id).toBeTruthy()
    expect(sub._id).toBeUndefined()
    expect(sub.text).toBe('Call the garage')
    expect(sub.done).toBe(false)

    const toggled = await request
      .patch(`/me/tasks/${taskId}/subtasks/${sub.id}`)
      .set('Authorization', auth(session.accessToken))
      .send({ done: true })
    expect(toggled.status).toBe(200)
    expect(toggled.body.task.subtasks[0].id).toBe(sub.id)
    expect(toggled.body.task.subtasks[0].done).toBe(true)

    const removed = await request
      .delete(`/me/tasks/${taskId}/subtasks/${sub.id}`)
      .set('Authorization', auth(session.accessToken))
    expect(removed.status).toBe(200)
    expect(removed.body.task.subtasks).toHaveLength(0)
  })

  it('gives every subtask a distinct, non-empty id across multiple adds', async () => {
    const session = await signUp()
    const created = await request
      .post('/me/tasks')
      .set('Authorization', auth(session.accessToken))
      .send(taskPayload())
    const taskId = created.body.task.id

    await request
      .post(`/me/tasks/${taskId}/subtasks`)
      .set('Authorization', auth(session.accessToken))
      .send({ text: 'Step one' })
    const second = await request
      .post(`/me/tasks/${taskId}/subtasks`)
      .set('Authorization', auth(session.accessToken))
      .send({ text: 'Step two' })

    const ids = second.body.task.subtasks.map((s: { id: string }) => s.id)
    expect(ids).toHaveLength(2)
    expect(ids.every((id: string) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(2)
  })
})
