import { describe, expect, it } from 'vitest'
import { needsReview, gateAndKey, makeItemKey } from './gate'
import type { DraftItem } from './contract'

function item(partial: Partial<DraftItem> & { title: string }): DraftItem {
  return {
    domain: 'home',
    priority: 'normal',
    confidence: 'high',
    reviewReason: 'clear',
    reasons: [],
    ...partial,
  }
}

describe('needsReview (the gate)', () => {
  it.each([
    [{ confidence: 'high', reviewReason: 'clear' }, false],
    [{ confidence: 'high', reviewReason: 'vague_date' }, true],
    [{ confidence: 'medium', reviewReason: 'clear' }, true],
    [{ confidence: 'low', reviewReason: 'clear' }, true],
    [{ confidence: 'low', reviewReason: 'ambiguous_intent' }, true],
  ] as const)('%o -> needsReview=%s', (input, expected) => {
    expect(needsReview(input)).toBe(expected)
  })
})

describe('gateAndKey', () => {
  it('routes only high+clear to autoSave, the rest to review', () => {
    const { autoSave, review } = gateAndKey('note1', [
      item({ title: 'Sure thing' }),
      item({ title: 'Fuzzy', confidence: 'low' }),
      item({ title: 'Dated', reviewReason: 'vague_date' }),
    ])
    expect(autoSave.map((i) => i.title)).toEqual(['Sure thing'])
    expect(review.map((i) => i.title)).toEqual(['Fuzzy', 'Dated'])
  })

  it('routes any item with a clarification block to the clarify lane', () => {
    const { autoSave, review, clarify } = gateAndKey('note1', [
      item({ title: 'Sure thing' }),
      // A clarifiable hold takes the clarify lane EVEN IF the model marked it
      // high+clear — presence of a clarification block wins over the gate.
      item({
        title: 'See the doctor',
        clarification: {
          question: 'The 17th or the 19th?',
          kind: 'date',
          options: [{ label: 'The 17th' }, { label: 'The 19th' }],
        },
      }),
      item({ title: 'Fuzzy', confidence: 'low' }),
    ])
    expect(autoSave.map((i) => i.title)).toEqual(['Sure thing'])
    expect(review.map((i) => i.title)).toEqual(['Fuzzy'])
    expect(clarify.map((i) => i.title)).toEqual(['See the doctor'])
    // Clarify items still get a deterministic note-scoped key (index 1 here).
    expect(clarify[0]?.key).toBe(makeItemKey('note1', 1, 'See the doctor'))
  })

  it('assigns deterministic, position-stable keys', () => {
    const items = [item({ title: 'Alpha' }), item({ title: 'Beta' })]
    const { autoSave } = gateAndKey('noteX', items)
    expect(autoSave[0]?.key).toBe(makeItemKey('noteX', 0, 'Alpha'))
    expect(autoSave[1]?.key).toBe(makeItemKey('noteX', 1, 'Beta'))
  })

  it('gives two same-title items distinct keys (position-scoped)', () => {
    const { autoSave } = gateAndKey('noteX', [item({ title: 'Same' }), item({ title: 'Same' })])
    expect(autoSave[0]?.key).not.toBe(autoSave[1]?.key)
  })

  it('produces the same key across runs for the same note+position+title', () => {
    expect(makeItemKey('n', 3, 'Renew Insurance')).toBe(makeItemKey('n', 3, 'renew insurance'))
  })
})
