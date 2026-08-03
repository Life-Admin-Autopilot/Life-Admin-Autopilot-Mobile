'use client'

import { useTranslations } from 'next-intl'

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
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onToggleDone,
  onLongPress,
  onClear,
}: {
  result: SearchResult
  selectMode: boolean
  selected: Set<string>
  onToggleSelect: (task: Task) => void
  onOpen: (task: Task, rect: DOMRect) => void
  onToggleDone: (task: Task) => void
  /** Same press-and-hold entry as the main list — an answer IS the list while
   *  it is on screen, so the gesture cannot stop working here. */
  onLongPress?: (task: Task) => void
  onClear: () => void
}) {
  const t = useTranslations('matters')

  if (result.matches.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <SketchEmptyTrayGlyph />
        <p className="text-body font-medium text-ink">{t('results.nothingMatched')}</p>
        <p className="text-caption text-ink-subtle">{result.answer}</p>
        <button type="button" onClick={onClear} className="mt-2 text-caption text-accent">
          {t('results.backToAll')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Just the answer, in a sentence, the way a person would say it. No
          sparkle, no shouting label: the question is still sitting in the search
          box above, so echoing it here only adds furniture. */}
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-body text-ink">
        {result.answer}
      </p>

      {/* Says so out loud rather than quietly answering from a slice — a search
          that only looked at part of your backlog is a different claim. */}
      {result.truncated ? (
        <p className="px-1 text-caption text-ink-subtle">{t('results.truncated')}</p>
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
              onLongPress={onLongPress}
            />
            {match.reason ? (
              <p className="px-4 pb-2 -mt-1 text-caption text-ink-subtle">{match.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>

      <button type="button" onClick={onClear} className="py-1 text-caption text-accent">
        {t('results.backToAll')}
      </button>
    </div>
  )
}
