#!/usr/bin/env node
// Guards how Arabic actually reaches SF Arabic. Post-build: reads the compiled
// CSS, not the source, because every failure this catches happens during the
// build rather than in globals.css.
//
// Three things have to stay true, and all three have been broken at some point:
//
// 1. NO METRIC FALLBACK IN THE STACKS. next/font appends `"Nunito Fallback"` to
//    its variable, and that face is `src: local(Arial)`. Arial carries full
//    Arabic on Apple platforms, so its presence anywhere ahead of the Arabic slot
//    means Arabic renders in Arial and nothing downstream is ever consulted.
//    globals.css therefore names the Latin families literally instead of using
//    the variable. `adjustFontFallback: false` would be the documented fix and
//    Turbopack ignores it, so this is checked rather than trusted.
//
// 2. THE LITERAL NAMES STILL RESOLVE. Naming a family that next/font has renamed
//    would silently drop Nunito/Fraunces and render everything in the system
//    font. next/font/google emits unhashed names today; if that changes, this
//    fails loudly instead of shipping a differently-typeset app.
//
// 3. THE SYSTEM KEYWORD COMES BEFORE THE ARABIC WEBFONT. `-apple-system` has to
//    be consulted before IBM Plex Sans Arabic, or Apple devices get Plex — the
//    correct fallback for everyone else, and not what was asked for here.
//
// Run after `next build`:  node scripts/check-font-stacks.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const CHUNKS = '.next/static/chunks'
const LATIN_FAMILIES = ['Nunito', 'Fraunces']
const STACKS = ['--font-display', '--font-serif', '--font-sans', '--font-wordmark']

if (!existsSync(CHUNKS)) {
  console.error(`No ${CHUNKS} — run \`npm run build\` first.`)
  process.exit(1)
}

const css = readdirSync(CHUNKS)
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(join(CHUNKS, name), 'utf8'))
  .join('\n')

if (css.length === 0) {
  console.error(`No CSS in ${CHUNKS} — run \`npm run build\` first.`)
  process.exit(1)
}

const problems = []

for (const family of LATIN_FAMILIES) {
  // The face itself must exist under exactly the name globals.css asks for.
  if (!new RegExp(String.raw`font-family:\s*["']?${family}["']?\s*[;}]`).test(css)) {
    problems.push(
      `no @font-face declares "${family}" — next/font may have renamed it, and globals.css names it literally`,
    )
  }
}

function declaration(name) {
  return new RegExp(String.raw`${name}:\s*([^;}]+)`).exec(css)?.[1] ?? null
}

// One level of indirection, because that is where the bug hides: a stack reading
// `var(--font-nunito)` has no "Fallback" in its own text — the Arial-backed face
// is inside the variable's definition. Checking the stack verbatim would pass a
// stack that is broken.
function expand(value) {
  return value.replace(/var\((--font-[\w-]+)\)/g, (whole, name) => declaration(name) ?? whole)
}

for (const stack of STACKS) {
  const raw = declaration(stack)
  if (!raw) {
    problems.push(`${stack} is not in the compiled CSS`)
    continue
  }
  const value = expand(raw)

  const system = value.indexOf('-apple-system')
  if (system === -1) {
    problems.push(`${stack} has no -apple-system — Apple devices cannot reach SF Arabic`)
    continue
  }

  // Only what sits AHEAD of the system keyword can steal Arabic from it. The
  // Arabic webfont's own Arial fallback is behind it and therefore harmless.
  if (/Fallback/.test(value.slice(0, system))) {
    problems.push(
      `${stack} has a next/font metric fallback (Arial-backed) ahead of -apple-system, ` +
        `so Arabic renders in Arial: ${raw.trim()}`,
    )
  }

  const arabic = value.indexOf('IBM Plex Sans Arabic')
  if (arabic !== -1 && system > arabic) {
    problems.push(`${stack} puts the Arabic webfont before -apple-system, so Apple gets Plex`)
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.length} font-stack problem(s) found.\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  process.exit(1)
}

console.log(`Font stack check passed — ${STACKS.length} stacks reach SF Arabic on Apple.`)
