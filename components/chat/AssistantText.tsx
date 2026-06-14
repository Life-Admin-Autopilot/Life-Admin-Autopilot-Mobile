// Lightweight markdown renderer for assistant turns (web). Handles paragraphs,
// bullet/numbered lists, inline bold + code, and citation markers
// ([task:<id>] / [voice:<id>]) → inline chips resolved against the message's
// sources. Built in-house (not a markdown lib) so citation chips stay
// interactive and partial streamed input (an unclosed `**`) renders cleanly.
//
// Ported from v1 (components/chat/AssistantMarkdown.tsx), retargeted to DOM.

import type { ReactNode } from 'react'

import type { AiSource } from '@/lib/ai/types'

interface AssistantTextProps {
  text: string
  sources: AiSource[]
  /** Static caret pinned to the tail of an in-progress turn. */
  streaming?: boolean
}

type Block =
  | { kind: 'paragraph'; raw: string }
  | { kind: 'bullet'; raw: string }
  | { kind: 'numbered'; ordinal: string; raw: string }

type Inline =
  | { kind: 'text'; value: string; bold?: boolean; code?: boolean }
  | { kind: 'chip'; rawKind: 'task' | 'voice'; id: string; source: AiSource | null }

const CITATION_RE = /\[(task|voice):([a-f0-9]{24})\]/i
const TOKEN_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[(?:task|voice):[a-f0-9]{24}\])/gi

function parseBlocks(text: string): Block[] {
  const out: Block[] = []
  const lines = text.split('\n')
  let paragraph: string[] = []
  const flush = () => {
    if (paragraph.length > 0) {
      out.push({ kind: 'paragraph', raw: paragraph.join(' ').trim() })
      paragraph = []
    }
  }
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flush()
      continue
    }
    const bullet = line.match(/^\s*[*\-+]\s+(.*)$/)
    if (bullet) {
      flush()
      out.push({ kind: 'bullet', raw: bullet[1] })
      continue
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/)
    if (numbered) {
      flush()
      out.push({ kind: 'numbered', ordinal: numbered[1], raw: numbered[2] })
      continue
    }
    paragraph.push(line)
  }
  flush()
  return out
}

function parseInline(text: string, sourceMap: Map<string, AiSource>): Inline[] {
  const out: Inline[] = []
  let cursor = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const start = match.index ?? 0
    if (start > cursor) out.push({ kind: 'text', value: text.slice(cursor, start) })
    const tok = match[0]
    if (tok.startsWith('**')) {
      out.push({ kind: 'text', value: tok.slice(2, -2), bold: true })
    } else if (tok.startsWith('`')) {
      out.push({ kind: 'text', value: tok.slice(1, -1), code: true })
    } else {
      const cm = CITATION_RE.exec(tok)
      if (cm) {
        const rawKind = cm[1].toLowerCase() as 'task' | 'voice'
        const id = cm[2]
        out.push({ kind: 'chip', rawKind, id, source: sourceMap.get(`${rawKind}:${id}`) ?? null })
      }
    }
    cursor = start + tok.length
  }
  if (cursor < text.length) out.push({ kind: 'text', value: text.slice(cursor) })
  return out
}

function inlineNode(seg: Inline, key: number): ReactNode {
  if (seg.kind === 'chip') {
    if (!seg.source) {
      return (
        <span key={key} className="italic text-ink-subtle">
          (unverified)
        </span>
      )
    }
    return (
      <span
        key={key}
        className="mx-0.5 inline-flex items-center rounded-sm bg-accent-soft px-1.5 py-0.5 text-caption font-medium text-accent"
      >
        {seg.source.title}
      </span>
    )
  }
  if (seg.code) {
    return (
      <code key={key} className="rounded-sm bg-surface-sunken px-1 text-[0.85em] text-ink">
        {seg.value}
      </code>
    )
  }
  if (seg.bold) {
    return (
      <strong key={key} className="font-semibold text-ink">
        {seg.value}
      </strong>
    )
  }
  return <span key={key}>{seg.value}</span>
}

export function AssistantText({ text, sources, streaming = false }: AssistantTextProps) {
  const sourceMap = new Map<string, AiSource>()
  for (const s of sources) sourceMap.set(`${s.kind}:${s.id}`, s)

  const blocks = parseBlocks(text)
  if (blocks.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 text-body-sm text-ink">
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1
        const segs = parseInline(block.raw, sourceMap)
        const caret = isLast && streaming ? <span className="text-ink-subtle">▍</span> : null

        if (block.kind === 'paragraph') {
          return (
            <p key={i} dir="auto" className="leading-relaxed">
              {segs.map(inlineNode)}
              {caret}
            </p>
          )
        }
        const marker = block.kind === 'bullet' ? '•' : `${block.ordinal}.`
        return (
          <div key={i} dir="auto" className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-ink-subtle">{marker}</span>
            <span className="flex-1">
              {segs.map(inlineNode)}
              {caret}
            </span>
          </div>
        )
      })}
    </div>
  )
}
