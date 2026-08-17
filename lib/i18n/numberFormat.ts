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

/**
 * How many minor units make one major unit of `currency`.
 *
 * Read off `Intl`'s own ISO 4217 data rather than assumed to be 100, because it
 * isn't: JPY has no minor unit at all and KWD has three places. Dividing every
 * currency by 100 renders ¥1,000 as ¥10 and 1.234 KWD as 12.340 — a wrong figure
 * that looks exactly as confident as a right one, in the one place the product
 * can least afford it.
 *
 * The server stores whole minor units on the same ISO table, so the two agree
 * without a second hand-maintained list on this side.
 */
/**
 * Whether to abbreviate the currency symbol for this locale.
 *
 * <p>Only in a left-to-right one. The narrow forms are Latin-script digraphs —
 * "E£" for EGP — and dropping one into an Arabic paragraph invites the bidi
 * algorithm to reorder it: "E£623" renders as "£E 623", which reads as British
 * pounds and is simply the wrong currency on screen.</p>
 *
 * <p>Arabic loses nothing by opting out. Its standard form is "ج.م.", which is
 * native, unambiguous, ordered correctly, and no wider in Arabic script than the
 * abbreviation would have been.</p>
 */
function narrowSymbolSuits(tag: string): boolean {
  return !tag.startsWith('ar')
}

function currencyOptions(currency: string, tag: string): Intl.NumberFormatOptions {
  return narrowSymbolSuits(tag)
    ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
    : { style: 'currency', currency }
}

function minorUnitsPerMajor(currency: string, tag: string): number {
  // `maximumFractionDigits` is optional in the type even though the currency
  // style always resolves it. Defaulting to 2 keeps the common case right if a
  // runtime ever omits it, rather than producing `10 ** undefined` = NaN and
  // rendering every figure as "NaN".
  const digits = formatter(tag, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits
  return 10 ** (digits ?? 2)
}

/**
 * Minor units in (cents, fils, whole yen), formatted string out.
 *
 * `narrowSymbol` to match `formatCurrencyRounded`: the two run side by side on
 * the money page — a rounded headline above a column of exact rows — and mixing
 * "E£4,800" with "EGP 4,800.00" reads as two different currencies. Where a
 * currency has no narrow form (KWD), Intl falls back to the code on its own.
 */
export function formatCurrency(minor: number, currency: string, tag: string): string {
  return formatter(tag, currencyOptions(currency, tag)).format(
    minor / minorUnitsPerMajor(currency, tag),
  )
}

/**
 * The same figure, compact — "E£1,235" rather than "EGP 1,234.56".
 *
 * Two differences from the exact form, both bought by the same constraint: these
 * are the headline figures, and they sit in half-width tiles on a 375px screen.
 *
 * The fraction goes because a six-figure sum rendered to the cent spends its two
 * most prominent characters on precision nobody reads at a glance — and the rows
 * underneath still carry the exact amounts.
 *
 * The symbol narrows because "EGP 4,800" overflows its tile at display sizes and
 * "E£4,800" does not. It is also what a person writes by hand.
 */
export function formatCurrencyRounded(minor: number, currency: string, tag: string): string {
  return formatter(tag, { ...currencyOptions(currency, tag), maximumFractionDigits: 0 }).format(
    minor / minorUnitsPerMajor(currency, tag),
  )
}
