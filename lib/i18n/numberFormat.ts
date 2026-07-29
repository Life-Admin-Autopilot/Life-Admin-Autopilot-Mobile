// Locale-aware number and currency formatting. Same caching rationale as
// dateFormat.ts — `new Intl.NumberFormat(...)` is expensive and these run per
// row.
//
// Because the Arabic tag pins `-u-nu-latn`, every number here renders with
// Western digits, which is what keeps `font-variant-numeric: tabular-nums`
// aligning columns in StatTile / CompletionRing / DeadlineMeter.

const cache = new Map<string, Intl.NumberFormat>()

function formatter(tag: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${tag}|${JSON.stringify(options)}`
  const hit = cache.get(key)
  if (hit) return hit
  const made = new Intl.NumberFormat(tag, options)
  cache.set(key, made)
  return made
}

export function formatCount(value: number, tag: string): string {
  return formatter(tag, {}).format(value)
}

/** Minor units in (cents), formatted string out. */
export function formatCurrency(cents: number, currency: string, tag: string): string {
  return formatter(tag, { style: 'currency', currency }).format(cents / 100)
}
