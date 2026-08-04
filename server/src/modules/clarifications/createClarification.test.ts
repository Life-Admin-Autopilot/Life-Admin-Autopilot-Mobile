import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'

import { Clarification } from '../../models/Clarification'
import { createClarification } from './createClarification'

describe('createClarification', () => {
  it('persists an open held item and returns its id + title', async () => {
    const userId = new Types.ObjectId().toHexString()
    const taskId = new Types.ObjectId().toHexString()
    const out = await createClarification({
      userId,
      taskId,
      costOfWrong: 'high',
      draft: { title: 'Gift for brother', domain: 'family', priority: 'normal' },
      question: 'Is his birthday next Friday or the Friday after?',
      kind: 'date',
      options: [
        { label: 'Next Friday', dueAt: new Date('2026-06-05T00:00:00.000Z') },
        { label: 'The Friday after', dueAt: new Date('2026-06-12T00:00:00.000Z') },
      ],
    })

    expect(out.title).toBe('Gift for brother')
    expect(typeof out.clarificationId).toBe('string')

    const doc = await Clarification.findById(out.clarificationId)
    expect(doc?.status).toBe('open')
    expect(doc?.options.length).toBe(2)
    expect(String(doc?.userId)).toBe(userId)
    // The question is anchored to a real task — never a free-floating draft.
    expect(String(doc?.taskId)).toBe(taskId)
  })

  it('defaults priority + empty options/tags for a detail hold', async () => {
    const userId = new Types.ObjectId().toHexString()
    const taskId = new Types.ObjectId().toHexString()
    const out = await createClarification({
      userId,
      taskId,
      costOfWrong: 'high',
      draft: { title: 'Sort out the thing', domain: 'home' },
      question: 'What thing?',
      kind: 'detail',
      options: [],
    })
    const doc = await Clarification.findById(out.clarificationId)
    expect(doc?.draft.priority).toBe('normal')
    expect(doc?.draft.tags).toEqual([])
    expect(doc?.options).toEqual([])
  })

  // The card is answered later, away from the conversation — without the user's
  // own words it shows only Kitto's paraphrase of a request they can't see.
  it('stores the request the question came out of, verbatim', async () => {
    const out = await createClarification({
      userId: new Types.ObjectId().toHexString(),
      taskId: new Types.ObjectId().toHexString(),
      costOfWrong: 'high',
      draft: { title: 'Email that guy', domain: 'home' },
      question: "What's the email to that guy about?",
      kind: 'detail',
      options: [],
      sourceText: '  Email that guy back about the quote — the one from last week.  ',
    })
    const doc = await Clarification.findById(out.clarificationId)
    expect(doc?.sourceText).toBe('Email that guy back about the quote — the one from last week.')
  })

  it('leaves sourceText unset when there is nothing to quote', async () => {
    const out = await createClarification({
      userId: new Types.ObjectId().toHexString(),
      taskId: new Types.ObjectId().toHexString(),
      costOfWrong: 'high',
      draft: { title: 'Sort out the thing', domain: 'home' },
      question: 'What thing?',
      kind: 'detail',
      options: [],
      sourceText: '   ',
    })
    const doc = await Clarification.findById(out.clarificationId)
    expect(doc?.sourceText).toBeUndefined()
  })
})
