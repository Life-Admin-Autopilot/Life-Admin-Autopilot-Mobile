import { describe, expect, it } from 'vitest'
import { dedupeItems, normalizeTitle } from './dedupe'
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

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Pay the Water-Bill!!')).toBe('pay the water bill')
  })
})

describe('dedupeItems', () => {
  it('collapses an exact (normalized) duplicate silently, survivor untouched', () => {
    const out = dedupeItems([
      item({ title: 'Pay water bill', domain: 'finance' }),
      item({ title: 'pay water BILL', domain: 'finance' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.confidence).toBe('high')
    expect(out[0]?.reviewReason).toBe('clear')
  })

  it('merges a fuzzy near-duplicate, flags it, preserves the dropped phrasing', () => {
    const out = dedupeItems([
      item({ title: 'Book the dentist appointment', domain: 'health' }),
      item({ title: 'Book the dentist appointment please', domain: 'health' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.reviewReason).toBe('maybe_duplicate')
    expect(out[0]?.confidence).toBe('medium') // demoted so it routes to review
    expect(out[0]?.notes).toContain('Also heard')
    expect(out[0]?.notes).toContain('please')
  })

  it('does NOT merge two genuinely different tasks below the threshold', () => {
    // {call,the,vet} vs {call,the,vet,back} = 3/4 = 0.75 < 0.8
    const out = dedupeItems([
      item({ title: 'Call the vet', domain: 'pets' }),
      item({ title: 'Call the vet back', domain: 'pets' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('does NOT merge identical titles in different domains', () => {
    const out = dedupeItems([
      item({ title: 'Renew it', domain: 'car' }),
      item({ title: 'Renew it', domain: 'home' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('preserves first-occurrence order', () => {
    const out = dedupeItems([
      item({ title: 'Alpha', domain: 'home' }),
      item({ title: 'Beta', domain: 'home' }),
      item({ title: 'Alpha', domain: 'home' }),
    ])
    expect(out.map((i) => i.title)).toEqual(['Alpha', 'Beta'])
  })
})
