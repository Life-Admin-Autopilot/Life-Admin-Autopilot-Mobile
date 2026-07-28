import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { Clarification } from './Clarification'

describe('Clarification model — toJSON', () => {
  it('exposes id, strips _id/__v, and keeps options + draft', async () => {
    const due = new Date('2026-06-18T00:00:00.000Z')
    const doc = await Clarification.create({
      userId: new Types.ObjectId(),
      taskId: new Types.ObjectId(),
      status: 'open',
      draft: { title: 'Car insurance renewal', domain: 'car', priority: 'high', tags: ['admin'] },
      question: 'Is it the 15th or the 18th?',
      kind: 'date',
      options: [
        { label: 'The 15th', dueAt: new Date('2026-06-15T00:00:00.000Z') },
        { label: 'The 18th', dueAt: due },
      ],
    })

    const json = doc.toJSON() as Record<string, unknown>

    expect(typeof json.id).toBe('string')
    expect(json._id).toBeUndefined()
    expect(json.__v).toBeUndefined()
    expect(json.status).toBe('open')
    expect(json.kind).toBe('date')
    expect((json.draft as { title: string }).title).toBe('Car insurance renewal')
    expect((json.draft as { tags: string[] }).tags).toEqual(['admin'])
    expect((json.options as unknown[]).length).toBe(2)
    expect((json.options as { label: string }[])[1]?.label).toBe('The 18th')
  })

  it('defaults status to open and priority to normal', async () => {
    const doc = await Clarification.create({
      userId: new Types.ObjectId(),
      taskId: new Types.ObjectId(),
      draft: { title: 'Email someone', domain: 'family' },
      question: 'Who is it to?',
      kind: 'detail',
    })
    expect(doc.status).toBe('open')
    expect(doc.draft.priority).toBe('normal')
    expect(doc.options).toEqual([])
    // Defaults to the cautious side: don't act on a guess we were unsure
    // enough about to ask.
    expect(doc.costOfWrong).toBe('high')
  })
})
