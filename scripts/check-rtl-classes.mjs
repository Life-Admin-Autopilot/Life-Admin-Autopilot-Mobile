#!/usr/bin/env node
// Guards the RTL conversion.
//
// Physical-direction Tailwind classes do not mirror: `pl-4` stays on the visual
// left in Arabic while its container flips around it, so the padding lands on
// the wrong side of the text. The logical forms (ps/pe, ms/me, start/end,
// text-start/end) are direction-aware, and the app was converted to them
// wholesale during the i18n work. This exists so those ~54 sites don't grow
// back one PR at a time.
//
// Lives here rather than in eslint.config.mjs because that file is protected by
// a repo hook. Wire into CI as `node scripts/check-rtl-classes.mjs`.
//
// Exemptions:
//   - components/layout/PhoneFrame.tsx — draws a physical iPhone; its left/right
//     are the volume rocker and power button, and hardware does not mirror.
//   - `left-1/2` / `right-1/2` — paired with -translate-x-1/2 this is a centring
//     idiom, not a side, and has no logical equivalent.
//   - a line carrying `rtl-allow-physical` in a comment, on it or just above it.
//     For the one-off: a whole-file entry above would blind the checker to every
//     future mistake in that file, which is too big a hammer for one class.

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOTS = ['app', 'components']
const EXEMPT_FILES = new Set(['components/layout/PhoneFrame.tsx'])

// Marker for a single deliberate physical class. The reason goes in the same
// comment, because a bare marker is indistinguishable from a suppressed bug.
const ALLOW_LINE = 'rtl-allow-physical'

// The value alternation must include the fraction form (`1/2`) BEFORE the
// bare-number form, or `left-1/2` matches as `left-1` and the centring
// exemption below can never recognise it.
const VALUE = String.raw`auto|full|px|\d+\/\d+|[\d.]+|\[[^\]]*\]`

const PATTERN = new RegExp(
  String.raw`(?<![\w-])(?:-?(?:pl|pr|ml|mr)-(?:${VALUE})|-?(?:left|right)-(?:${VALUE})|text-(?:left|right))(?![\w-])`,
  'g',
)

const REPLACEMENTS = {
  pl: 'ps',
  pr: 'pe',
  ml: 'ms',
  mr: 'me',
  left: 'start',
  right: 'end',
  'text-left': 'text-start',
  'text-right': 'text-end',
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(path)
    else if (path.endsWith('.tsx')) yield path
  }
}

function suggest(match) {
  if (REPLACEMENTS[match]) return REPLACEMENTS[match]
  const prefix = match.replace(/^-/, '').split('-')[0]
  const logical = REPLACEMENTS[prefix]
  return logical ? match.replace(prefix, logical) : 'the logical equivalent'
}

const violations = []

for (const root of ROOTS) {
  for (const file of walk(root)) {
    // Forward slashes, ALWAYS. `relative` returns the platform separator, so on
    // Windows this read `components\layout\PhoneFrame.tsx` and never matched the
    // exemption written with `/` — the PhoneFrame entry above had simply never
    // worked on this machine, and its four deliberate classes failed the check
    // on every run. A permanently-red gate is one nobody reads.
    const rel = relative(process.cwd(), file).split(sep).join('/')
    if (EXEMPT_FILES.has(rel)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Skip comment lines — prose about "the right side" is not a class.
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

      // The marker sits on the class line or in the comment explaining it, which
      // is usually the line above — that is where the reason is already written.
      if (line.includes(ALLOW_LINE) || (lines[i - 1] ?? '').includes(ALLOW_LINE)) return

      for (const match of line.matchAll(PATTERN)) {
        const found = match[0]
        // Centring idiom, not a side.
        if (/^-?(left|right)-1\/2$/.test(found)) continue
        violations.push({ file: rel, line: i + 1, found })
      }
    })
  }
}

if (violations.length > 0) {
  console.error(`\n${violations.length} physical-direction class(es) found.`)
  console.error("These won't mirror in Arabic — use the logical form.\n")
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.found}  →  ${suggest(v.found)}`)
  }
  console.error('')
  process.exit(1)
}

console.log('RTL check passed — no physical-direction classes.')
