// Point Kitto at a real calendar feed and print exactly what it would make of
// it — without a route, a database, or a UI.
//
// This exists because the ICS work is currently a set of libraries with no
// surface. It is also the fastest way to answer open verification item #3 in
// docs/integrations.md: we confirmed the MECHANISM of subscribable feeds, but
// not the HIT RATE among real schools and councils. Run this against ten of them
// and you have the answer.
//
//   npm run ics-probe -- <feed-url> [--tz Europe/London] [--time 09:00]
//
// Re-run the same URL with the printed ETag to watch the conditional GET turn a
// second poll into a 304 with no body.

import ICAL from 'ical.js'
import { fetchFeed } from '../src/modules/integrations/ics/fetchFeed'
import { resolveIcsTime } from '../src/modules/integrations/ics/resolveIcsTime'

interface Args {
  url?: string
  timezone: string
  defaultTimeOfDay: string
  etag?: string
  limit: number
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    defaultTimeOfDay: '09:00',
    limit: 15,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--tz' && next) args.timezone = next
    else if (token === '--time' && next) args.defaultTimeOfDay = next
    else if (token === '--etag' && next) args.etag = next
    else if (token === '--limit' && next) args.limit = Number(next)
    else if (token && !token.startsWith('--')) args.url ??= token
  }
  return args
}

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const GREEN = '\x1b[32m'

function tone(confidence: string): string {
  if (confidence === 'low') return RED
  if (confidence === 'medium') return YELLOW
  return GREEN
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.url) {
    console.error('Usage: npm run ics-probe -- <feed-url> [--tz Zone] [--time HH:mm] [--etag ETag]')
    process.exit(1)
  }

  console.log(`${DIM}feed     ${RESET}${args.url}`)
  console.log(`${DIM}as user  ${RESET}${args.timezone}, imports default ${args.defaultTimeOfDay}`)
  if (args.etag) console.log(`${DIM}sending  ${RESET}If-None-Match: ${args.etag}`)
  console.log()

  const started = Date.now()
  const result = await fetchFeed(args.url, args.etag ? { etag: args.etag } : {})
  const elapsed = Date.now() - started

  if (result.status !== 'ok') {
    const label = result.status === 'unchanged' ? '304 NOT MODIFIED' : result.status.toUpperCase()
    console.log(`${label} ${DIM}(${elapsed}ms)${RESET}`)
    if ('reason' in result) console.log(result.reason)
    if (result.status === 'unchanged') {
      console.log(`\n${DIM}The conditional GET worked — no body transferred, nothing to parse.${RESET}`)
    }
    return
  }

  console.log(`200 OK ${DIM}(${elapsed}ms, ${result.body.length} bytes)${RESET}`)
  if (result.etag) console.log(`${DIM}etag     ${RESET}${result.etag}`)
  if (result.lastModified) console.log(`${DIM}modified ${RESET}${result.lastModified}`)
  console.log()

  const comp = new ICAL.Component(ICAL.parse(result.body))
  const vevents = comp.getAllSubcomponents('vevent')
  console.log(`${vevents.length} VEVENT(s). Showing up to ${args.limit}.\n`)

  let needingConfirmation = 0
  let recurring = 0

  for (const vevent of vevents.slice(0, args.limit)) {
    const dtstart = vevent.getFirstProperty('dtstart')
    if (!dtstart) continue

    const summary = String(vevent.getFirstPropertyValue('summary') ?? '(no summary)')
    const hasRrule = vevent.getFirstProperty('rrule') !== null
    if (hasRrule) recurring += 1

    try {
      const resolved = resolveIcsTime(dtstart, {
        timezone: args.timezone,
        defaultTimeOfDay: args.defaultTimeOfDay,
      })
      if (resolved.needsConfirmation) needingConfirmation += 1

      const colour = tone(resolved.confidence)
      console.log(`${summary}${hasRrule ? `${DIM} [recurring]${RESET}` : ''}`)
      console.log(`  ${DIM}raw   ${RESET}${resolved.rawLine}`)
      console.log(`  ${DIM}fires ${RESET}${resolved.dueAt.toISOString()}`)
      console.log(
        `  ${colour}${resolved.precision} · ${resolved.confidence}${RESET} ${DIM}— ${resolved.note}${RESET}` +
          (resolved.needsConfirmation ? `  ${RED}ASKS THE USER${RESET}` : ''),
      )
      console.log()
    } catch (error: unknown) {
      console.log(`${summary}\n  ${RED}unresolvable${RESET} — ${String(error)}\n`)
    }
  }

  console.log(`${DIM}────${RESET}`)
  console.log(`${recurring} of the shown events carry an RRULE (expansion is not built yet).`)
  console.log(
    needingConfirmation > 0
      ? `${RED}${needingConfirmation}${RESET} would be shown to the user for confirmation rather than scheduled silently.`
      : 'None needed confirmation — every time in this feed was unambiguous.',
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
