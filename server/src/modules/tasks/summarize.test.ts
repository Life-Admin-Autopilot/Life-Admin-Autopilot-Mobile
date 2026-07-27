import { describe, expect, it } from 'vitest'
import { stripObjectIds } from './summarize'

// The model is instructed never to put a raw id in prose. It does anyway, so
// this is the enforcement. Every case below is a shape actually observed or
// one step away from it.
describe('stripObjectIds', () => {
  it('removes the "(e.g., <id>)" parenthetical the model favours', () => {
    const input =
      "It looks like you have many entries for 'Pay electricity bill' (e.g., 6a63c5c4d005286d1e6a8235) all due on July 30th; is this intentional?"
    expect(stripObjectIds(input)).toBe(
      "It looks like you have many entries for 'Pay electricity bill' all due on July 30th; is this intentional?",
    )
  })

  it('removes a bare id and repairs the spacing around it', () => {
    expect(stripObjectIds('Is 6a63c5c4d005286d1e6a8235 still worth keeping?')).toBe(
      'Is still worth keeping?',
    )
  })

  it('leaves clean prose untouched', () => {
    const clean = 'You have moved "Renew passport" five times. Is this still real?'
    expect(stripObjectIds(clean)).toBe(clean)
  })

  it('drops text that is only an id, rather than emitting a fragment', () => {
    expect(stripObjectIds('6a63c5c4d005286d1e6a8235')).toBeNull()
    expect(stripObjectIds('(e.g., 6a63c5c4d005286d1e6a8235)')).toBeNull()
  })

  it('does not mangle ordinary hex-looking words', () => {
    // 24 chars is the trigger; shorter hex strings are left alone.
    const input = 'Check the deadbeef reference on the invoice.'
    expect(stripObjectIds(input)).toBe(input)
  })
})
