// The user's own words, prepared for storage on a Clarification.
//
// Two very different inputs land here: a chat message (usually one sentence)
// and a whole voice-note transcript (one recording can carry six matters, so
// the same paragraph is quoted by every question it produced). Both are stored
// verbatim up to a ceiling — the card clamps to a few lines anyway, and an
// unbounded copy of a five-minute transcript on every row is a lot of Mongo for
// text nobody reads past the third line.

/** Longest quote we keep. Roughly a short paragraph — well past what the card shows. */
export const MAX_SOURCE_TEXT = 600

/**
 * Trim, cap, and drop the empty case. Returns undefined rather than '' so the
 * field is simply absent on rows with nothing worth quoting — the card then
 * renders exactly as it did before this existed.
 */
export function clampSourceText(text: string | undefined | null): string | undefined {
  const trimmed = text?.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= MAX_SOURCE_TEXT) return trimmed
  return `${trimmed.slice(0, MAX_SOURCE_TEXT - 1).trimEnd()}…`
}
