// The /documents list's right-hand time column.
//
// A list row has room for roughly eight characters here, so precision is spent
// where it is actually useful: within today the exact clock time matters
// ("did that scan just land?"), within the week the weekday is enough, and
// beyond that only the date is. This is the same ladder a mail or chat list
// uses, and users read it without a legend.
//
// Pure and calendar-day based (not elapsed hours): a scan from 11pm last night
// is "Yesterday" at 1am, never "2 hours ago".

const DAY_MS = 86_400_000

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function formatScanTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  const daysApart = Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / DAY_MS)

  // A clock-skewed or client-future timestamp falls through to the date form
  // rather than rendering a nonsensical "in 3 days" in a scan history.
  if (daysApart === 0) {
    return then.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  if (daysApart === 1) return 'Yesterday'
  if (daysApart > 1 && daysApart < 7) {
    return then.toLocaleDateString(undefined, { weekday: 'short' })
  }
  if (then.getFullYear() === now.getFullYear()) {
    return then.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })
  }
  return then.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  })
}
