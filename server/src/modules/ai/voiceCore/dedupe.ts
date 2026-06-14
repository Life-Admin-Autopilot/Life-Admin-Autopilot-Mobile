import type { DraftItem } from './contract'

// Collapse near-duplicate intents from rambling speech ("renew insurance...
// oh and don't forget the insurance"). Deterministic + testable: normalized
// title -> token Jaccard, gated on same domain.
//
// INVARIANT: dedupe NEVER drops content. An exact restatement collapses
// silently (genuinely one task). A fuzzy near-duplicate keeps the survivor,
// preserves the merged-away phrasing in notes/reasons, and forces the survivor
// into review (maybe_duplicate) so a real distinct task can never vanish.

const MERGE_THRESHOLD = 0.8

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter(Boolean))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

interface Survivor {
  item: DraftItem
  norm: string
  tokens: Set<string>
}

export function dedupeItems(items: DraftItem[]): DraftItem[] {
  const survivors: Survivor[] = []

  for (const item of items) {
    const norm = normalizeTitle(item.title)
    const tokens = tokenize(item.title)
    const match = survivors.find(
      (s) => s.item.domain === item.domain && (s.norm === norm || jaccard(s.tokens, tokens) >= MERGE_THRESHOLD),
    )

    if (!match) {
      survivors.push({ item, norm, tokens })
      continue
    }

    // Exact restatement → silent collapse, survivor untouched.
    if (match.norm === norm) continue

    // Fuzzy near-duplicate → preserve the dropped phrasing + flag for review.
    const droppedNote = `Also heard: "${item.title}"`
    const reasons = Array.from(
      new Set([...match.item.reasons, `Might be the same as "${item.title}"`]),
    ).slice(0, 4)
    match.item = {
      ...match.item,
      // Demote so the conservative gate routes it to review.
      confidence: match.item.confidence === 'high' ? 'medium' : match.item.confidence,
      reviewReason: match.item.reviewReason === 'clear' ? 'maybe_duplicate' : match.item.reviewReason,
      reasons,
      notes: match.item.notes ? `${match.item.notes}\n${droppedNote}` : droppedNote,
    }
  }

  return survivors.map((s) => s.item)
}
