'use client'

import { ArrowDown, ArrowUp, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/cn'
import { formatRange } from '@/lib/taskFormat'
import { SUMMARY_RANGES, useSummarize, type TaskSummary } from '@/queries/mattersAi'
import type { TaskFilters } from '@/queries/tasks'
import { ChipToggle, Sheet, SheetSection } from './Sheet'

// "Summarize my next month" — a structured report, not a paragraph.
//
// Two rules hold this together:
//
//   1. Every number is computed server-side from real documents. The model only
//      names themes and writes the one question. A figure that came out of a
//      language model is a place for a confident wrong answer to hide.
//
//   2. Every number is a way INTO the list. Tapping "4 slipped" filters the
//      workspace to those four. A summary you can't drill into is just a claim.

export function SummarySheet({
  open,
  onClose,
  trigger,
  onDrillDown,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  /** Applies a filter to the list and closes — the summary's whole payoff. */
  onDrillDown: (filters: TaskFilters, label: string) => void
}) {
  const [rangeLabel, setRangeLabel] = useState(SUMMARY_RANGES[1].label)
  const summarize = useSummarize()
  const summary = summarize.data ?? null

  const runFor = (label: string) => {
    const preset = SUMMARY_RANGES.find((r) => r.label === label)
    if (!preset) return
    setRangeLabel(label)
    summarize.mutate(preset.range(new Date()))
  }

  // Run once on open so the sheet never shows an empty shell with a button.
  useEffect(() => {
    if (!open || summarize.isPending || summarize.data) return
    const preset = SUMMARY_RANGES.find((r) => r.label === rangeLabel)
    if (preset) summarize.mutate(preset.range(new Date()))
    // Deliberately keyed on `open` alone: re-running on every mutation state
    // change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const range = summary
    ? { dueAfter: summary.range.from, dueBefore: summary.range.to }
    : null

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={620}
      eyebrow="What's coming"
      title={rangeLabel}
    >
      <div className="flex flex-wrap gap-1.5 pb-1">
        {SUMMARY_RANGES.map((r) => (
          <ChipToggle
            key={r.label}
            selected={rangeLabel === r.label}
            onClick={() => runFor(r.label)}
          >
            {r.label}
          </ChipToggle>
        ))}
      </div>

      {summarize.isPending ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Loader2 size={20} className="animate-spin text-accent" />
          <p className="text-caption text-ink-subtle">Reading your matters…</p>
        </div>
      ) : summarize.isError ? (
        <p className="py-10 text-center text-caption text-ink-subtle">
          Couldn&apos;t put a summary together. Try again in a moment.
        </p>
      ) : summary ? (
        <Report
          summary={summary}
          range={range}
          onDrillDown={(f, label) => {
            onDrillDown(f, label)
            onClose()
          }}
        />
      ) : null}
    </Sheet>
  )
}

function Report({
  summary,
  range,
  onDrillDown,
}: {
  summary: TaskSummary
  range: { dueAfter: string; dueBefore: string } | null
  onDrillDown: (filters: TaskFilters, label: string) => void
}) {
  const { counts } = summary
  const delta = counts.completedInRange - counts.completedPrevious

  if (counts.dueInRange === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-body font-medium text-ink">Nothing scheduled.</p>
        <p className="mt-1 text-caption text-ink-subtle">
          {formatRange(summary.range.from, summary.range.to)} is clear.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <p className="pt-1 text-body text-ink">{summary.headline}</p>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat
          n={counts.dueInRange}
          label="Due"
          onClick={range ? () => onDrillDown(range, 'Due in range') : undefined}
        />
        <Stat
          n={counts.overdue}
          label="Slipped"
          accent={counts.overdue > 0}
          onClick={() => onDrillDown({ overdue: true }, 'Slipped')}
        />
        <Stat
          n={counts.completedInRange}
          label="Done"
          // Comparing against the same-length window immediately before is the
          // only honest way to say whether this is a lot.
          delta={counts.completedPrevious > 0 || counts.completedInRange > 0 ? delta : undefined}
          onClick={() =>
            onDrillDown(
              {
                status: ['done'],
                completedAfter: summary.range.from,
                completedBefore: summary.range.to,
              },
              'Completed',
            )
          }
        />
      </div>

      {summary.themes.length > 0 ? (
        <SheetSection label="Themes">
          <ul className="flex flex-col gap-1.5">
            {summary.themes.map((theme) => (
              <li key={theme.label}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-body-sm font-medium text-ink">
                    {theme.label}
                  </span>
                  <span className="shrink-0 text-caption tabular text-ink-subtle">
                    {theme.count}
                  </span>
                </div>
                <p className="truncate text-caption text-ink-subtle">
                  {theme.examples.filter(Boolean).join(' · ')}
                </p>
              </li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {/* Duplicates come before slipping: they are the most common way a list
          silently becomes untrustworthy, since the same bill can arrive by
          chat, by voice, and off a scanned document. Tapping one filters the
          list to those copies so they can be dealt with. */}
      {summary.duplicates.length > 0 ? (
        <SheetSection label="Looks duplicated">
          <ul className="flex flex-col gap-1">
            {summary.duplicates.map((dupe) => (
              <li key={dupe.title}>
                <button
                  type="button"
                  onClick={() => onDrillDown({ q: dupe.title }, dupe.title)}
                  className="flex w-full items-baseline justify-between gap-2 text-left"
                >
                  <span className="truncate text-body-sm text-ink">{dupe.title}</span>
                  <span className="shrink-0 text-caption tabular text-accent">
                    {dupe.count} copies
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {summary.slipping.length > 0 ? (
        <SheetSection label="Slipping">
          <ul className="flex flex-col gap-1">
            {summary.slipping.map((slip) => (
              <li key={slip.taskId} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-body-sm text-ink">{slip.title}</span>
                <span className="shrink-0 text-caption text-accent">{slip.reason}</span>
              </li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {summary.unplannedCompleted.length > 0 ? (
        <SheetSection label="Done but never planned">
          <ul className="flex flex-col gap-0.5">
            {summary.unplannedCompleted.map((t) => (
              <li key={t.taskId} className="truncate text-body-sm text-ink-muted">
                {t.title}
              </li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {/* Suppressed when duplicates are present: a pile-up on one day is USUALLY
          just the duplicates, and two lavender cards explaining the same cluster
          reads as the app repeating itself. */}
      {summary.duplicates.length === 0 && summary.busiestDay && summary.busiestDay.count > 2 ? (
        <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-caption text-ink-muted">
          <span className="tabular font-medium">{summary.busiestDay.count}</span> matters land on{' '}
          {new Date(`${summary.busiestDay.date}T12:00:00`).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
          . Worth spreading out?
        </p>
      ) : null}

      {summary.question ? (
        <p className="mt-3 rounded-md bg-accent-soft px-3 py-2.5 text-body-sm text-ink">
          <Sparkles size={12} className="mr-1 inline text-accent" />
          {summary.question.text}
        </p>
      ) : null}
    </div>
  )
}

function Stat({
  n,
  label,
  delta,
  accent,
  onClick,
}: {
  n: number
  label: string
  delta?: number
  accent?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick || n === 0}
      className="flex flex-col items-center rounded-lg border border-border bg-surface py-2.5 transition-colors enabled:hover:bg-surface-sunken disabled:opacity-60"
    >
      <span
        className={cn(
          'font-display text-heading-xl tabular',
          accent && n > 0 ? 'text-accent' : 'text-ink',
        )}
      >
        {n}
      </span>
      <span className="text-caption text-ink-muted">{label}</span>
      {delta !== undefined && delta !== 0 ? (
        <span
          className={cn(
            'flex items-center text-micro tabular',
            delta > 0 ? 'text-accent' : 'text-ink-subtle',
          )}
        >
          {delta > 0 ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
          {Math.abs(delta)}
        </span>
      ) : null}
    </button>
  )
}
