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

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['app', 'components']
const EXEMPT_FILES = new Set(['components/layout/PhoneFrame.tsx'])

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
    const rel = relative(process.cwd(), file)
    if (EXEMPT_FILES.has(rel)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Skip comment lines — prose about "the right side" is not a class.
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

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
