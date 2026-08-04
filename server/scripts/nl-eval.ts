// Natural-language eval harness for Kitto.
//
// Calls REAL Gemini through the same streamPersonal + system prompt +
// prefill that production users hit. For each case we build the same
// "=== NOW === / === MY TASKS === / ..." scaffold the contextBuilder
// produces in real chat, then assert on the tool calls Kitto emits.
//
//   npm run nl-eval          — the core suite (one clean intent per prompt)
//   npm run nl-eval:hard     — the hard suite (spoken, multi-intent, adversarial)
//   npm run nl-eval:all      — both
//
//   --suite=core|hard|all    same as the scripts above
//   --concurrency=N          cases in flight (default 4)
//   --filter=SUBSTR          only categories containing SUBSTR — iterate on one
//                            group without paying for the whole run
//
// Requires GEMINI_API_KEY in server/.env. Roughly $0.06 per 60 cases.

import 'dotenv/config'

import type { Content } from '@google/genai'

import { isAiConfigured, getGeminiClient } from '../src/modules/ai/provider/geminiClient'
import { streamPersonal } from '../src/modules/ai/provider/streamPersonal'
import { getPrefillContents, getSystemPrompt } from '../src/modules/ai/voice'
import { DEFAULT_AI_LOCALE } from '../src/modules/ai/promptLanguage'
import type { CaseOutcome, EvalCase, ExpectedTool, FakeTask } from './nlEval/types'
import { CORE_CASES } from './nlEval/cases.core'
import { HARD_CASES } from './nlEval/cases.hard'

// ─── Context builder (mirrors the production scaffold) ───────────────────

function nowIsoLocal(): string {
  // Local time with offset, the same shape contextBuilder.formatNow produces.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

function renderTaskBlock(tasks: FakeTask[] | undefined): string {
  if (!tasks || tasks.length === 0) return '(no open tasks)'
  return tasks
    .map((t) => {
      const due = t.dueAt ? ` — due ${t.dueAt}` : ''
      const prio = t.priority && t.priority !== 'normal' ? ` — ${t.priority}` : ''
      const tags =
        t.tags && t.tags.length > 0 ? ` — tags: ${t.tags.join(', ')}` : ''
      const lines = [`[task:${t.id}] ${t.title}${due} — ${t.domain} — ${t.status}${prio}${tags}`]
      for (const s of t.subtasks ?? []) {
        lines.push(`    ${s.done ? '[x]' : '[ ]'} <subtask:${s.id}> ${s.text}`)
      }
      if (t.notes) lines.push(`    notes: ${t.notes}`)
      return lines.join('\n')
    })
    .join('\n')
}

function buildContents(c: EvalCase): Content[] {
  const taskBlock = renderTaskBlock(c.tasks)
  const user = [
    `=== NOW ===`,
    nowIsoLocal(),
    `=== MY TASKS ===`,
    taskBlock,
    `=== RECENT VOICE NOTES ===`,
    '(none)',
    `=== END ===`,
    c.prompt,
  ].join('\n')

  // Prior turns sit between the prefill and the live turn, exactly where the
  // real conversation history goes.
  const history: Content[] = (c.history ?? []).map((h) => ({
    role: h.role,
    parts: [{ text: h.text }],
  }))

  return [...getPrefillContents(), ...history, { role: 'user', parts: [{ text: user }] }]
}

// ─── Matcher ─────────────────────────────────────────────────────────────

// Server-side defaults — if the model omits a key that the server fills in
// to this value, count it as equivalent. Prevents penalizing Kitto for not
// being redundant with the schema default.
const SERVER_DEFAULTS: Record<string, unknown> = {
  priority: 'normal',
  status: 'open',
}

/** Expected-value sentinel: the key must be present, any value. */
const ANY_VALUE = '*'

function argsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): { ok: true } | { ok: false; reason: string } {
  for (const [key, want] of Object.entries(expected)) {
    const got = actual[key]

    // "Must be present at all" — what the urgent-with-no-date and
    // default-a-date cases are really asserting. The VALUE is the model's to
    // choose; its absence is the bug.
    if (want === ANY_VALUE) {
      if (got === undefined || got === null || got === '') {
        return { ok: false, reason: `${key}: expected a value, got nothing` }
      }
      continue
    }

    if (key === 'title' && typeof want === 'string') {
      // Case-insensitive substring match.
      if (typeof got !== 'string' || !got.toLowerCase().includes(want.toLowerCase())) {
        return { ok: false, reason: `title "${String(got)}" missing "${want}"` }
      }
      continue
    }

    if (key === 'text' && typeof want === 'string') {
      // Subtask body — same substring rule as title.
      if (typeof got !== 'string' || !got.toLowerCase().includes(want.toLowerCase())) {
        return { ok: false, reason: `text "${String(got)}" missing "${want}"` }
      }
      continue
    }

    if (Array.isArray(want)) {
      if (!Array.isArray(got)) {
        return { ok: false, reason: `${key} not an array (got ${JSON.stringify(got)})` }
      }
      for (const item of want) {
        if (typeof item === 'string') {
          const hit = got.some(
            (g) => typeof g === 'string' && g.toLowerCase().includes(item.toLowerCase()),
          )
          if (!hit) return { ok: false, reason: `${key}: missing "${item}"` }
        }
      }
      continue
    }

    // Treat an omitted key as equivalent to the server's default value.
    // e.g. expect `priority: 'normal'` matches `args` with no priority key.
    if (got === undefined && SERVER_DEFAULTS[key] === want) {
      continue
    }

    if (got !== want) {
      return { ok: false, reason: `${key}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}` }
    }
  }
  return { ok: true }
}

type ActualCall = { name: string; args: Record<string, unknown> }

function matchTools(
  expected: ExpectedTool[],
  actual: ActualCall[],
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []

  if (expected.length === 0) {
    if (actual.length > 0) {
      return {
        ok: false,
        reasons: [
          `expected NO tools, model fired ${actual.length}: ${actual.map((a) => a.name).join(', ')}`,
        ],
      }
    }
    return { ok: true }
  }

  // For each expected tool call we need at least one actual call with the
  // same name and matching subset of args. Each actual call can only
  // satisfy one expectation.
  const claimed = new Set<number>()
  for (const want of expected) {
    let satisfied = false
    for (let i = 0; i < actual.length; i++) {
      if (claimed.has(i)) continue
      const act = actual[i]
      if (!act) continue
      if (act.name !== want.name) continue
      if (want.args) {
        const m = argsMatch(want.args, act.args)
        if (!m.ok) continue
      }
      claimed.add(i)
      satisfied = true
      break
    }
    if (!satisfied) {
      const argDesc = want.args ? ` with ${JSON.stringify(want.args)}` : ''
      reasons.push(`missing ${want.name}${argDesc}`)
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

// What `tools` structurally cannot say. `tools` is an AT-LEAST assertion, so it
// passes just as happily when the model fires a duplicate createTask for an
// item it already held, or splits one bulk wipe into twelve deletes.
function checkCounts(
  bounds: NonNullable<EvalCase['expect']['toolCounts']>,
  actual: ActualCall[],
): string[] {
  const reasons: string[] = []
  for (const [name, bound] of Object.entries(bounds)) {
    const n = actual.filter((a) => a.name === name).length
    if (bound.min !== undefined && n < bound.min) {
      reasons.push(`${name}: expected at least ${bound.min}, got ${n}`)
    }
    if (bound.max !== undefined && n > bound.max) {
      reasons.push(`${name}: expected at most ${bound.max}, got ${n}`)
    }
  }
  return reasons
}

// A call that must NOT exist with these args — the retraction cases, where the
// abandoned value is the one being checked for.
function checkForbiddenArgs(forbidden: ExpectedTool[], actual: ActualCall[]): string[] {
  const reasons: string[] = []
  for (const bad of forbidden) {
    const hit = actual.find(
      (a) => a.name === bad.name && (!bad.args || argsMatch(bad.args, a.args).ok),
    )
    if (hit) {
      reasons.push(`${bad.name} must NOT carry ${JSON.stringify(bad.args)} — got ${JSON.stringify(hit.args)}`)
    }
  }
  return reasons
}

const ARABIC = /[؀-ۿ]/g
const LATIN_RUN = /[A-Za-z]{4,}/g

// Script check for the reply prose. Deliberately lenient about a stray token:
// a preserved proper noun is REQUIRED to stay in its original script
// (promptLanguage.verbatimClause), so the test is "which language is this
// written in", not "does one foreign character appear".
function checkReplyScript(want: 'arabic' | 'latin', text: string): string[] {
  const arabicChars = (text.match(ARABIC) ?? []).length
  const latinWords = (text.match(LATIN_RUN) ?? []).length

  if (want === 'arabic') {
    if (arabicChars === 0) return ['reply is not in Arabic (no Arabic characters)']
    if (latinWords >= 6) return [`reply drifts to English (${latinWords} Latin words)`]
    return []
  }
  if (latinWords === 0) return ['reply is not in English (no Latin words)']
  if (arabicChars >= 10) return [`reply drifts to Arabic (${arabicChars} Arabic characters)`]
  return []
}

function evaluate(c: EvalCase, toolCalls: ActualCall[], text: string): string[] {
  const reasons: string[] = []

  if (c.expect.tools) {
    const m = matchTools(c.expect.tools, toolCalls)
    if (!m.ok) reasons.push(...m.reasons)
  }

  // Alternative sanctioned answers — pass if ANY group is fully satisfied.
  if (c.expect.anyOf && c.expect.anyOf.length > 0) {
    const anyHit = c.expect.anyOf.some((group) => matchTools(group, toolCalls).ok)
    if (!anyHit) {
      const shapes = c.expect.anyOf
        .map((g) => g.map((t) => t.name).join('+'))
        .join('  OR  ')
      reasons.push(`none of the accepted shapes matched (${shapes})`)
    }
  }

  for (const name of c.expect.forbidTools ?? []) {
    if (toolCalls.some((t) => t.name === name)) {
      reasons.push(`should NOT have called ${name}`)
    }
  }

  if (c.expect.toolCounts) reasons.push(...checkCounts(c.expect.toolCounts, toolCalls))
  if (c.expect.forbidArgs) reasons.push(...checkForbiddenArgs(c.expect.forbidArgs, toolCalls))

  if (c.expect.textIncludes) {
    if (!text.toLowerCase().includes(c.expect.textIncludes.toLowerCase())) {
      reasons.push(`text missing "${c.expect.textIncludes}"`)
    }
  }

  if (c.expect.replyScript) reasons.push(...checkReplyScript(c.expect.replyScript, text))

  return reasons
}

// ─── Runner ──────────────────────────────────────────────────────────────

async function runCase(c: EvalCase): Promise<CaseOutcome> {
  const client = getGeminiClient()
  const contents = buildContents(c)

  const toolCalls: ActualCall[] = []
  let text = ''

  // The locale is what the LANGUAGE rule is built from. This used to be called
  // with no argument at all, which rendered the rule as "Write every word the
  // user will read in undefined." — every multi-language case was graded
  // against a malformed prompt.
  const systemInstruction = getSystemPrompt(c.locale ?? DEFAULT_AI_LOCALE)

  for await (const ev of streamPersonal({ client, systemInstruction, contents })) {
    if (ev.kind === 'token') text += ev.text
    else if (ev.kind === 'tool_call') toolCalls.push({ name: ev.name, args: ev.args })
  }

  const reasons = evaluate(c, toolCalls, text)
  return { case: c, toolCalls, text, pass: reasons.length === 0, reasons }
}

// ─── Reporting ───────────────────────────────────────────────────────────

const COLORS = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function printCase(i: number, total: number, out: CaseOutcome) {
  const verdict = out.pass ? COLORS.green('PASS') : COLORS.red('FAIL')
  const cat = out.case.category.padEnd(20)
  console.log(`\n[${i + 1}/${total}] ${cat} ${verdict}`)
  const prompt =
    out.case.prompt.length > 200 ? `${out.case.prompt.slice(0, 200)}…` : out.case.prompt
  console.log(`  ${COLORS.dim('prompt:')} ${prompt}`)

  if (out.toolCalls.length === 0) {
    console.log(`  ${COLORS.dim('tools: ')} ${COLORS.yellow('(none)')}`)
  } else {
    for (const tc of out.toolCalls) {
      console.log(`  ${COLORS.dim('tool:  ')} ${COLORS.bold(tc.name)} ${JSON.stringify(tc.args)}`)
    }
  }

  if (out.text.trim().length > 0) {
    const preview = out.text.length > 160 ? `${out.text.slice(0, 160)}…` : out.text
    console.log(`  ${COLORS.dim('text:  ')} ${preview.replace(/\n/g, ' ')}`)
  }

  if (!out.pass) {
    // The trap first — it says what the case was defending against, which is
    // the context you need to judge whether the failure is real or the
    // assertion is too tight.
    if (out.case.trap) console.log(`  ${COLORS.yellow('trap:  ')} ${out.case.trap}`)
    for (const r of out.reasons) {
      console.log(`  ${COLORS.red('✗')} ${r}`)
    }
  }
}

function printSummary(outcomes: CaseOutcome[]) {
  const byCat = new Map<string, { pass: number; total: number }>()
  for (const o of outcomes) {
    const cat = o.case.category
    const row = byCat.get(cat) ?? { pass: 0, total: 0 }
    row.total++
    if (o.pass) row.pass++
    byCat.set(cat, row)
  }

  const passed = outcomes.filter((o) => o.pass).length
  const total = outcomes.length

  console.log(`\n${COLORS.bold('═══ Summary ═══')}\n`)
  for (const [cat, row] of [...byCat.entries()].sort()) {
    const pct = Math.round((row.pass / row.total) * 100)
    const bar = pct >= 80 ? COLORS.green(`${pct}%`) : pct >= 50 ? COLORS.yellow(`${pct}%`) : COLORS.red(`${pct}%`)
    console.log(`  ${cat.padEnd(22)} ${row.pass}/${row.total}  ${bar}`)
  }
  const overall = Math.round((passed / total) * 100)
  const overallColor =
    overall >= 90 ? COLORS.green : overall >= 70 ? COLORS.yellow : COLORS.red
  console.log(
    `\n  ${COLORS.bold('OVERALL'.padEnd(22))} ${passed}/${total}  ${overallColor(`${overall}%`)}\n`,
  )

  const failed = outcomes.filter((o) => !o.pass)
  if (failed.length > 0) {
    console.log(COLORS.bold('  Failed cases:'))
    for (const f of failed) {
      console.log(`    ${COLORS.red('✗')} ${f.case.category}  ${COLORS.dim(f.case.prompt.slice(0, 70))}`)
    }
    console.log()
  }
}

// ─── CLI ─────────────────────────────────────────────────────────────────

function flag(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

function selectCases(): { cases: EvalCase[]; label: string } {
  const suite = flag('suite', 'core')
  const filter = flag('filter', '')

  const base =
    suite === 'hard' ? HARD_CASES : suite === 'all' ? [...CORE_CASES, ...HARD_CASES] : CORE_CASES

  const cases = filter
    ? base.filter((c) => c.category.toLowerCase().includes(filter.toLowerCase()))
    : base

  return { cases, label: filter ? `${suite} (filter: ${filter})` : suite }
}

// Bounded pool. Cases are independent, so the only reason this was sequential
// was that nothing had needed the wall-clock back. Results print IN ORDER as
// they settle — an out-of-order dump of 111 cases is unreadable.
async function runPool(
  cases: EvalCase[],
  concurrency: number,
  onSettled: (i: number, out: CaseOutcome) => void,
): Promise<CaseOutcome[]> {
  const results: Array<CaseOutcome | undefined> = new Array(cases.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= cases.length) return
      const c = cases[i]
      if (!c) continue
      try {
        results[i] = await runCase(c)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        results[i] = { case: c, toolCalls: [], text: '', pass: false, reasons: [message] }
      }
      const out = results[i]
      if (out) onSettled(i, out)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, () => worker()),
  )
  return results.filter((r): r is CaseOutcome => r !== undefined)
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  if (!isAiConfigured()) {
    console.error(COLORS.red('GEMINI_API_KEY is not set in server/.env. Aborting.'))
    process.exit(1)
  }

  const { cases, label } = selectCases()
  if (cases.length === 0) {
    console.error(COLORS.red(`No cases matched suite "${label}".`))
    process.exit(1)
  }

  const concurrency = Math.max(1, Number(flag('concurrency', '4')) || 4)

  console.log(
    COLORS.bold(`\nRunning ${cases.length} ${label} cases against real Gemini…\n`),
  )
  console.log(
    COLORS.dim(`(temperature=default, prompt+prefill = production, concurrency=${concurrency})\n`),
  )

  // Print in index order even though completion order is arbitrary: hold each
  // result until every case before it has settled, then flush the run.
  const pending = new Map<number, CaseOutcome>()
  let cursor = 0
  const flush = () => {
    for (;;) {
      const out = pending.get(cursor)
      if (!out) return
      printCase(cursor, cases.length, out)
      pending.delete(cursor)
      cursor++
    }
  }

  const outcomes = await runPool(cases, concurrency, (i, out) => {
    pending.set(i, out)
    flush()
  })

  printSummary(outcomes)
  process.exit(outcomes.every((o) => o.pass) ? 0 : 1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
