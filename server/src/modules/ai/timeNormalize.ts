// Server-side ISO 8601 normalization. The model often emits naive ISO
// (`2026-05-17T18:00:00`) or the wrong offset; the server is the source
// of truth, not the prompt. Mirrors Wiscord's pattern verbatim.
//
// Strict regex — accepts:
//   YYYY-MM-DDTHH:MM[:SS[.sss]]            (naive)
//   YYYY-MM-DDTHH:MM[:SS[.sss]]Z           (UTC)
//   YYYY-MM-DDTHH:MM[:SS[.sss]]+HH:MM      (offset)
//   YYYY-MM-DDTHH:MM[:SS[.sss]]-HH:MM
//
// Rejects space-separated, no-time, and anything looser.

export const STRICT_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/

export function hasOffset(iso: string): boolean {
  return /Z$|[+-]\d{2}:\d{2}$/.test(iso)
}

// Treat a naive datetime as a wall-clock time in the caller's IANA tz,
// and return the corresponding absolute UTC Date.
//
// We can't construct a tz-aware Date directly in pure JS, so we use the
// Intl.DateTimeFormat round-trip trick: format an arbitrary UTC instant
// in the target zone, parse out the wall-clock components, compute the
// delta, and apply it back.
export function normalizeLocalIso(iso: string, timezone: string | undefined): Date {
  if (!STRICT_DATETIME_RE.test(iso)) {
    throw new Error(`invalid ISO 8601: ${iso}`)
  }
  if (hasOffset(iso)) {
    // Offset is explicit — parses unambiguously.
    return new Date(iso)
  }
  if (!timezone) {
    // No tz to anchor naive input. JS would otherwise parse this as
    // local-server time, which makes behavior depend on the host's TZ
    // env. Force UTC for deterministic semantics.
    return new Date(`${iso}Z`)
  }

  // Naive: interpret components as wall-clock in `timezone`.
  const match = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  )
  if (!match) throw new Error(`invalid ISO 8601: ${iso}`)
  const [, y, mo, d, h, mi, s] = match
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s ?? '0')

  // Start with a guess: that wall-clock interpreted as UTC.
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)

  // Compute the offset that the target timezone applies to `guess`.
  // `Intl` returns "GMT+03:00"-style strings; parse the +/-HH:MM out.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
    hour: 'numeric',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(guess))
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const offsetMatch = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/)
  const offsetMin = offsetMatch
    ? (offsetMatch[1] === '+' ? 1 : -1) *
      (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]))
    : 0

  // The wall-clock the user typed (e.g. 18:00) in `timezone` is `guess`
  // shifted by `-offsetMin` minutes back to UTC.
  return new Date(guess - offsetMin * 60 * 1000)
}

// Format a UTC instant as a human-readable string in the caller's tz.
// Used by tool result formatters so the model's history reads consistent
// with what the user sees.
export function formatInZone(date: Date, timezone: string | undefined): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}
