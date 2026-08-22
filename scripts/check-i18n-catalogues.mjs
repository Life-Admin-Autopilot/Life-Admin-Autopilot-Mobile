#!/usr/bin/env node
// Guards the message catalogues against the three ways they rot.
//
// 1. MISSING KEYS. messages.ts casts ar.json to `typeof en`, and a cast does not
//    catch a missing property — TypeScript allows asserting a narrower object
//    type to a wider one. So a key added to en.json and forgotten in ar.json
//    compiles cleanly and renders as a raw key path at runtime, in production,
//    to the one audience that cannot read the fallback.
//
// 2. DROPPED PLACEHOLDERS. `"Waiting on confirmation for {email}."` translated
//    without its `{email}` loses the address silently — next-intl renders the
//    sentence, just without the fact in it. Worse in the other direction: a
//    placeholder the English message does not have throws at render.
//
// 3. UNTRANSLATED COPY. An Arabic value byte-identical to its English one is
//    almost always a paste that was never translated. Some genuinely are the
//    same (brand names, an email example), so those are listed rather than
//    guessed at.
//
// Sibling of check-rtl-classes.mjs; wire into CI the same way:
//   node scripts/check-i18n-catalogues.mjs

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'lib/i18n/messages'
const REFERENCE = 'en'

// Values that are legitimately identical across languages. Brand names are not
// translated, and a placeholder address is a literal.
const SAME_IN_BOTH = new Set([
  'profile.planPro',
  'profile.google.title',
  'profile.rows.google',
  'profile.email.placeholder',
  // Nothing but placeholders and an en dash — there is no word in it to translate.
  'matters.range.between',
  // A bare {time}. The chip is the clock reading and nothing else; the digits
  // are localised by the formatter that produces the value, not here.
  'uncertainty.chip.at',
])

function flatten(value, prefix = '') {
  if (typeof value !== 'object' || value === null) return { [prefix]: value }
  return Object.entries(value).reduce(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  )
}

// ICU placeholders only. Depth-aware on purpose: a plural's bodies are
// themselves brace-wrapped (`one {# matter}`, `=0 {No matters}`), so a flat regex
// reads "No" out of the body and then reports every correct Arabic plural as
// having dropped it. Real placeholders sit at depth 1 and are a bare name closed
// by `}` or followed by `,`; body text is at depth 2 and never matches.
function placeholders(message) {
  if (typeof message !== 'string') return new Set()
  const found = new Set()
  let depth = 0
  for (let i = 0; i < message.length; i += 1) {
    const char = message[i]
    if (char === '}') {
      depth -= 1
      continue
    }
    if (char !== '{') continue
    depth += 1
    if (depth !== 1) continue
    const match = /^\{\s*(\w+)\s*[,}]/.exec(message.slice(i))
    if (match) found.add(match[1])
  }
  return found
}

// One directory per locale, one file per namespace inside it — see the header of
// lib/i18n/messages.ts for why. Walking the directory rather than naming the
// namespaces means a new namespace is covered the moment it exists, which is the
// case most likely to be forgotten.
function loadLocale(dir) {
  const merged = {}
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const namespace = file.replace(/\.json$/, '')
    merged[namespace] = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  }
  return flatten(merged)
}

const catalogues = Object.fromEntries(
  readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => [entry.name, loadLocale(join(DIR, entry.name))]),
)

const reference = catalogues[REFERENCE]
if (!reference) {
  console.error(`No ${REFERENCE}.json in ${DIR} — nothing to compare against.`)
  process.exit(1)
}

const problems = []

for (const [locale, catalogue] of Object.entries(catalogues)) {
  if (locale === REFERENCE) continue

  for (const key of Object.keys(reference)) {
    if (!(key in catalogue)) {
      problems.push(`${locale}: missing key  ${key}`)
      continue
    }

    const want = placeholders(reference[key])
    const got = placeholders(catalogue[key])
    for (const name of want) {
      if (!got.has(name)) problems.push(`${locale}: ${key} drops {${name}}`)
    }
    for (const name of got) {
      if (!want.has(name)) problems.push(`${locale}: ${key} adds unknown {${name}}`)
    }

    if (catalogue[key] === reference[key] && !SAME_IN_BOTH.has(key)) {
      problems.push(`${locale}: ${key} is still the English string`)
    }
  }

  for (const key of Object.keys(catalogue)) {
    if (!(key in reference)) problems.push(`${locale}: ${key} is not in ${REFERENCE}.json`)
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} catalogue problem(s) found.\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  process.exit(1)
}

const locales = Object.keys(catalogues).length
const keys = Object.keys(reference).length
console.log(`i18n check passed — ${keys} keys, ${locales} locales, no drift.`)
