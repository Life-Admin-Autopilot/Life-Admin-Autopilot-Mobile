// Two-turn Mo probe — like nl-probe, but after the first model turn it feeds
// SYNTHETIC functionResponses back for every tool call and runs a SECOND
// model turn, so you can see the follow-up message (e.g. the "needs your
// call" list Mo emits after creating the clear tasks). No DB, no quota.
//
// Usage:
//   echo "your dump" | npm run nl-probe-loop -- --stdin
//   npm run nl-probe-loop -- "your dump here"

import 'dotenv/config'

import type { Content, Part } from '@google/genai'

import { isAiConfigured, getGeminiClient } from '../src/modules/ai/provider/geminiClient'
import { streamPersonal } from '../src/modules/ai/provider/streamPersonal'
import { getPrefillContents, getSystemPrompt } from '../src/modules/ai/voice'

function nowIsoLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => (buf += chunk))
    process.stdin.on('end', () => resolve(buf.trim()))
  })
}

interface TurnOut {
  text: string
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>
}

async function runTurn(contents: Content[]): Promise<TurnOut> {
  const client = getGeminiClient()
  let text = ''
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  for await (const ev of streamPersonal({
    client,
    systemInstruction: getSystemPrompt(),
    contents,
  })) {
    if (ev.kind === 'token') text += ev.text
    else if (ev.kind === 'tool_call') toolCalls.push({ name: ev.name, args: ev.args })
  }
  return { text: text.trim(), toolCalls }
}

function printTurn(label: string, turn: TurnOut): void {
  console.log(`\n─ ${label}: text ───────────────────────────────`)
  console.log(turn.text || '(no text)')
  console.log(`─ ${label}: tool calls (${turn.toolCalls.length}) ──────────────`)
  turn.toolCalls.forEach((tc, i) => {
    console.log(`[${i + 1}] ${tc.name} ${JSON.stringify(tc.args)}`)
  })
}

async function main() {
  if (!isAiConfigured()) {
    console.error('GEMINI_API_KEY is not set in server/.env.')
    process.exit(1)
  }
  const argv = process.argv.slice(2)
  const stdin = argv.includes('--stdin')
  const prompt = stdin ? await readStdin() : argv.filter((a) => a !== '--stdin').join(' ')
  if (!prompt) {
    console.error('Usage: echo "dump" | npm run nl-probe-loop -- --stdin')
    process.exit(1)
  }

  const userMessage = [
    '=== NOW ===',
    nowIsoLocal(),
    '=== MY TASKS ===',
    '(no open tasks)',
    '=== RECENT VOICE NOTES ===',
    '(none)',
    '=== END ===',
    prompt,
  ].join('\n')

  const baseContents: Content[] = [
    ...getPrefillContents(),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  // ── Turn 1 ──────────────────────────────────────────────────────────
  const turn1 = await runTurn(baseContents)
  printTurn('TURN 1', turn1)

  if (turn1.toolCalls.length === 0) {
    console.log('\n(no tool calls — nothing to feed back, stopping)')
    return
  }

  // ── Synthetic functionResponses + Turn 2 ───────────────────────────
  const modelParts: Part[] = [
    ...(turn1.text ? [{ text: turn1.text }] : []),
    ...turn1.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: tc.args } })),
  ]
  const responseParts: Part[] = turn1.toolCalls.map((tc, i) => ({
    functionResponse: {
      name: tc.name,
      response: { task: { id: `probe${i + 1}`, title: String(tc.args.title ?? 'task') } },
    },
  }))

  const turn2Contents: Content[] = [
    ...baseContents,
    { role: 'model', parts: modelParts },
    { role: 'user', parts: responseParts },
  ]

  const turn2 = await runTurn(turn2Contents)
  printTurn('TURN 2 (after tool results)', turn2)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
