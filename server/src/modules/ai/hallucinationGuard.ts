// Strip [task:X] / [voice:X] citations that don't reference an id the
// model was actually given in the turn's sources. US-09: if the AI cites
// data we never showed it, replace the chip with the "I don't have this"
// fallback so the user can't be misled.

const CITATION_RE = /\[(task|voice):([a-f0-9]{24})\]/gi

export interface AllowedCitation {
  kind: 'task' | 'voice'
  id: string
}

export function guardCitations(
  text: string,
  allowed: AllowedCitation[],
): { text: string; strippedCount: number } {
  const allowedSet = new Set(allowed.map((s) => `${s.kind}:${s.id}`))
  let strippedCount = 0
  const result = text.replace(CITATION_RE, (match, kind: string, id: string) => {
    const key = `${kind.toLowerCase()}:${id}`
    if (allowedSet.has(key)) return match
    strippedCount += 1
    return '(unverified)'
  })
  return { text: result, strippedCount }
}
