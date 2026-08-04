import { describe, expect, it } from 'vitest'

import { clampSourceText, MAX_SOURCE_TEXT } from './sourceQuote'

describe('clampSourceText', () => {
  it('keeps a normal request verbatim', () => {
    const said = 'Email that guy back about the quote — the one from last week.'
    expect(clampSourceText(said)).toBe(said)
  })

  it('trims surrounding whitespace', () => {
    expect(clampSourceText('  pay the bill  ')).toBe('pay the bill')
  })

  // Undefined rather than '': the card renders the quote only when there is
  // something to quote, and an empty block reads as a rendering bug.
  it.each([undefined, null, '', '   '])('drops the empty case (%p)', (input) => {
    expect(clampSourceText(input)).toBeUndefined()
  })

  it('caps a long transcript with an ellipsis rather than storing it whole', () => {
    const out = clampSourceText('a'.repeat(MAX_SOURCE_TEXT + 200))
    expect(out).toHaveLength(MAX_SOURCE_TEXT)
    expect(out?.endsWith('…')).toBe(true)
  })

  it('leaves text exactly at the ceiling untouched', () => {
    const exact = 'b'.repeat(MAX_SOURCE_TEXT)
    expect(clampSourceText(exact)).toBe(exact)
  })
})
