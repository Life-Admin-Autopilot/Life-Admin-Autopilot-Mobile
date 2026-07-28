// Ad-hoc Kitto response probe — paste any prompt, see exactly what Gemini
// returns. Same system prompt + prefill the production /ai/ask endpoint
// uses. No DB persistence, no quota, no SSE — straight call.
//
// Usage:
//   npm run nl-probe -- "your prompt here in any language"
//   npm run nl-probe -- --tasks 2 "اضف تاسك تاني"     # 2 pre-existing tasks in context
//   echo "your prompt" | npm run nl-probe -- --stdin   # pipe-friendly

import 'dotenv/config'

import type { Content } from '@google/genai'

import { isAiConfigured, getGeminiClient } from '../src/modules/ai/provider/geminiClient'
import { streamPersonal } from '../src/modules/ai/provider/streamPersonal'
import { getPrefillContents, getSystemPrompt } from '../src/modules/ai/voice'

const COLORS = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

interface FakeTask {
  id: string
  title: string
  domain: string
  status: string
  priority?: string
  dueAt?: string
}

const SEEDS: FakeTask[] = [
  {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Renew car insurance',
    domain: 'car',
    status: 'open',
    priority: 'normal',
  },
  {
    id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    title: 'Pay water bill',
    domain: 'home',
    status: 'open',
    priority: 'normal',
  },
  {
    id: 'cccccccccccccccccccccccc',
    title: 'Schedule dentist cleaning',
    domain: 'health',
    status: 'open',
    priority: 'normal',
  },
]

function nowIsoLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offMin) / 60))
  const om = pad(Math.abs(offMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

function renderTaskBlock(tasks: FakeTask[]): string {
  if (tasks.length === 0) return '(no open tasks)'
  return tasks
    .map((t) => {
      const due = t.dueAt ? ` — due ${t.dueAt}` : ''
      const prio = t.priority && t.priority !== 'normal' ? ` — ${t.priority}` : ''
      return `[task:${t.id}] ${t.title}${due} — ${t.domain} — ${t.status}${prio}`
    })
    .join('\n')
}

interface Args {
  prompt: string
  tasksCount: number
  stdin: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let tasksCount = 0
  let stdin = false
  const promptParts: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--tasks') {
      tasksCount = Number(argv[++i] ?? '0')
    } else if (a === '--stdin') {
      stdin = true
    } else if (a !== undefined) {
      promptParts.push(a)
    }
  }
  return { prompt: promptParts.join(' '), tasksCount, stdin }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk) => {
      buf += chunk
    })
    process.stdin.on('end', () => resolve(buf.trim()))
  })
}

async function main() {
  const args = parseArgs()

  if (!isAiConfigured()) {
    console.error(COLORS.red('GEMINI_API_KEY is not set in server/.env.'))
    process.exit(1)
  }

  const prompt = args.stdin ? await readStdin() : args.prompt
  if (!prompt) {
    console.error('Usage: npm run nl-probe -- "your prompt here"')
    console.error('       npm run nl-probe -- --tasks 2 "prompt with existing tasks"')
    console.error('       echo "prompt" | npm run nl-probe -- --stdin')
    process.exit(1)
  }

  const tasks = SEEDS.slice(0, Math.max(0, Math.min(args.tasksCount, SEEDS.length)))

  const userMessage = [
    '=== NOW ===',
    nowIsoLocal(),
    '=== MY TASKS ===',
    renderTaskBlock(tasks),
    '=== RECENT VOICE NOTES ===',
    '(none)',
    '=== END ===',
    prompt,
  ].join('\n')

  const contents: Content[] = [
    ...getPrefillContents(),
    { role: 'user', parts: [{ text: userMessage }] },
  ]

  console.log(`\n${COLORS.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n`)
  console.log(`${COLORS.dim('prompt:')} ${prompt}`)
  if (tasks.length > 0) {
    console.log(`${COLORS.dim('context:')} ${tasks.length} pre-existing task(s)`)
  }
  console.log(`\n${COLORS.cyan('streaming…')}\n`)

  const client = getGeminiClient()
  let text = ''
  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  let usage: Record<string, number | undefined> = {}

  for await (const ev of streamPersonal({
    client,
    systemInstruction: getSystemPrompt(),
    contents,
  })) {
    if (ev.kind === 'token') {
      text += ev.text
      process.stdout.write(ev.text)
    } else if (ev.kind === 'tool_call') {
      toolCalls.push({ name: ev.name, args: ev.args })
    } else if (ev.kind === 'done') {
      usage = ev.usage as Record<string, number | undefined>
    }
  }

  console.log(`\n\n${COLORS.bold('─ Kitto replied ─────────────────────────────────────')}`)
  console.log(text.trim() || COLORS.dim('(no text)'))

  console.log(`\n${COLORS.bold('─ Tool calls ─────────────────────────────────────')}`)
  if (toolCalls.length === 0) {
    console.log(COLORS.yellow('(none)'))
  } else {
    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
      if (!tc) continue
      console.log(`${COLORS.green(`[${i + 1}]`)} ${COLORS.bold(tc.name)}`)
      const argsLines = JSON.stringify(tc.args, null, 2).split('\n')
      for (const line of argsLines) {
        console.log(`    ${line}`)
      }
    }
  }

  if (usage.totalTokenCount) {
    console.log(
      `\n${COLORS.dim(
        `tokens: prompt=${usage.promptTokenCount ?? '?'}, completion=${usage.candidatesTokenCount ?? '?'}, total=${usage.totalTokenCount}`,
      )}`,
    )
  }
  console.log(`\n${COLORS.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
