'use client'

import { Sparkles } from 'lucide-react'

import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import type { SearchResult } from '@/queries/mattersAi'
import type { Task } from '@/queries/tasks'
import { MatterListRow } from './MatterListRow'

// The answer to a described search.
//
// Two decisions worth stating:
//
//   1. Results keep the order they came back in. Relevance ordering is the
//      entire product of a search — re-grouping them by due date, the way the
//      normal list does, would throw away the ranking that made the answer
//      useful.
//
//   2. Each row carries a one-clause reason. When someone searches by half a
//      memory, "why is this here?" is the immediate next question, and a row
//      that can't answer it is indistinguishable from a wrong result.

export function SearchResults({
  result,
  query,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onToggleDone,
  onClear,
}: {
  result: SearchResult
  query: string
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (task: Task) => void
  onOpen: (task: Task, rect: DOMRect) => void
  onToggleDone: (task: Task) => void
  onClear: () => void
}) {
  if (result.matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <SketchEmptyTrayGlyph />
        <p className="text-body font-medium text-ink">Nothing matched that.</p>
        <p className="text-caption text-ink-subtle">{result.answer}</p>
        <button type="button" onClick={onClear} className="mt-2 text-caption text-accent">
          Back to all matters
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-accent/30 bg-accent-soft px-4 py-3">
        <span className="flex items-center gap-1 text-label uppercase text-accent">
          <Sparkles size={11} />
          {query}
        </span>
        <p className="mt-0.5 text-body-sm text-ink">{result.answer}</p>
      </div>

      {/* Says so out loud rather than quietly answering from a slice — a search
          that only looked at part of your backlog is a different claim. */}
      {result.truncated ? (
        <p className="px-1 text-caption text-ink-subtle">
          Searched your most recent matters only — you have more than fit in one pass.
        </p>
      ) : null}

      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        {result.matches.map((match) => (
          <li key={match.task.id}>
            <MatterListRow
              task={match.task}
              selectable={selectMode}
              selected={selected.has(match.task.id)}
              onToggleSelect={onToggleSelect}
              onOpen={onOpen}
              onToggleDone={onToggleDone}
            />
            {match.reason ? (
              <p className="px-4 pb-2 -mt-1 text-caption text-ink-subtle">{match.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <button type="button" onClick={onClear} className="py-1 text-caption text-accent">
        Back to all matters
      </button>
    </div>
  )
}
