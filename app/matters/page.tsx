'use client'

import { AnimatePresence } from 'framer-motion'
import { ArrowRight, ListFilter, ArrowUpDown, CheckSquare, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { BulkDeleteConfirm } from '@/components/matters/BulkDeleteConfirm'
import { FilterSheet } from '@/components/matters/FilterSheet'
import { MatterDetailSheet } from '@/components/matters/MatterDetailSheet'
import { MatterListRow } from '@/components/matters/MatterListRow'
import { MattersSearchBar } from '@/components/matters/MattersSearchBar'
import { SearchResults } from '@/components/matters/SearchResults'
import { SummarySheet } from '@/components/matters/SummarySheet'
import { SelectionActionBar, SelectionToolbar } from '@/components/matters/SelectionBar'
import { SortSheet, type GroupMode } from '@/components/matters/SortSheet'
import { AppHeader } from '@/components/layout/AppHeader'
import { cn } from '@/lib/cn'
import { useClaimTabBarSlot } from '@/lib/tabBarStore'
import { toast } from '@/lib/toast'
import type { SearchResult } from '@/queries/mattersAi'
import {
  groupByDomain,
  groupByPriority,
  groupByTime,
  type TaskGroup,
} from '@/lib/taskFormat'
import {
  DOMAIN_LABEL,
  hasActiveFilters,
  useBulkAction,
  useBulkPreview,
  useCompleteTask,
  useTaskCounts,
  useTasks,
  useUndoBulk,
  type BulkPreview,
  type Task,
  type TaskFilters,
  type TaskSort,
} from '@/queries/tasks'

// Matters — every reminder the user has, in one place.
//
// The governing decision: this screen is a DECISION SURFACE, not an inventory.
// By default it shows only what needs attention (slipped / today / tomorrow)
// and folds the rest behind one tap. Showing someone their entire backlog on
// open is the single most reliable way to make them close the app.
//
// Grouping and filtering are lenses. Nothing on this screen ever moves a matter
// somewhere the user can't find it again.

// The buckets that constitute "needs attention". Everything else lives below
// the fold until asked for.
const ATTENTION = new Set(['overdue', 'today', 'tomorrow'])

// Hide completed matters by default — a done list is a log, not a workspace.
const DEFAULT_FILTERS: TaskFilters = { status: ['open', 'snoozed'] }

export default function MattersPage() {
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<TaskSort>('due-asc')
  const [group, setGroup] = useState<GroupMode>('time')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(false)

  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  // The open matter is held by ID, never as a copy. A copy is a snapshot taken
  // at open time, so adding a step, ticking one off, or deleting one wrote to
  // the server and the cache and left the sheet showing the old subtask list
  // until it was closed and reopened.
  const [detailId, setDetailId] = useState<string | null>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletePreview, setDeletePreview] = useState<BulkPreview | null>(null)

  // Each sheet morphs out of whatever opened it, so we hold the rect of the
  // last-tapped control. One slot is enough — only one sheet is ever open.
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)

  // The answer to the last described search. When this is set the page shows
  // the matched matters IN THE ORDER THEY CAME BACK — relevance order is the
  // whole point of a search, so it is deliberately not re-grouped by date.
  const [result, setResult] = useState<SearchResult | null>(null)
  const [answered, setAnswered] = useState<string | null>(null)

  // Typing deliberately does NOT filter.
  //
  // This box takes a description ("anything about renewing next month"), and a
  // description is not a substring of any title — so live-filtering on it wiped
  // the list to an empty state before the search had even run, which reads as
  // "you have nothing" rather than "you haven't asked yet". The list stays put
  // until the question is actually submitted.
  const onSearched = useCallback((res: SearchResult, query: string) => {
    setResult(res)
    setAnswered(query)
  }, [])

  const clearSearch = useCallback(() => {
    setResult(null)
    setAnswered(null)
    setFilters(DEFAULT_FILTERS)
    setSearch('')
  }, [])

  const list = useTasks(filters, sort)
  const counts = useTaskCounts()
  const completeTask = useCompleteTask()
  const bulkPreview = useBulkPreview()
  const bulkAction = useBulkAction()
  const undoBulk = useUndoBulk()

  const tasks = useMemo(
    () => list.data?.pages.flatMap((p) => p.tasks) ?? [],
    [list.data],
  )
  const total = list.data?.pages[0]?.total ?? 0
  const filtered = hasActiveFilters({ ...filters, status: undefined })

  // While an answer is on screen the results ARE the list, so bulk selection,
  // the detail sheet and completion all operate on them exactly as they would
  // on the normal list.
  const resultTasks = useMemo(() => result?.matches.map((m) => m.task) ?? [], [result])
  const visible = result ? resultTasks : tasks

  // Resolved from whichever list is showing, so the sheet re-renders with the
  // matter as the cache now knows it. Going undefined (deleted, or filtered
  // out) closes the sheet through its normal collapse.
  const detail = detailId ? visible.find((t) => t.id === detailId) ?? null : null

  const groups: TaskGroup[] = useMemo(() => {
    if (group === 'domain') return groupByDomain(tasks, DOMAIN_LABEL)
    if (group === 'priority') return groupByPriority(tasks)
    if (group === 'flat') return [{ key: 'all', label: 'All matters', tasks }]
    return groupByTime(tasks)
  }, [tasks, group])

  // The two-tier fold applies only to the unfiltered default view — once the
  // user has asked a specific question, they get the whole answer.
  const folded = group === 'time' && !filtered && !expanded && !result
  const visibleGroups = folded ? groups.filter((g) => ATTENTION.has(g.key)) : groups
  const shown = visibleGroups.reduce((n, g) => n + g.tasks.length, 0)
  const hidden = Math.max(0, total - shown)

  // Infinite scroll. Never auto-loads while folded — pulling in pages the user
  // can't see would burn data to render nothing.
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || folded || !list.hasNextPage || list.isFetchingNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void list.fetchNextPage()
    })
    io.observe(node)
    return () => io.disconnect()
  }, [folded, list])

  const toggleSelect = useCallback((task: Task) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(task.id)) next.delete(task.id)
      else next.add(task.id)
      return next
    })
  }, [])

  const exitSelect = useCallback(() => {
    setSelectMode(false)
    setSelected(new Set())
  }, [])

  // Every destructive or bulk action ends the same way: a toast that offers the
  // change back. The op is one server-side transaction, so Undo restores the
  // exact prior state rather than guessing at an inverse.
  const offerUndo = useCallback(
    (message: string, undoToken: string | null) => {
      if (!undoToken) {
        toast.info(message)
        return
      }
      toast.success(message, {
        action: {
          label: 'Undo',
          onPress: () =>
            undoBulk.mutate(undoToken, {
              onSuccess: () => toast.info('Restored.'),
              onError: () => toast.error('Could not undo that.'),
            }),
        },
      })
    },
    [undoBulk],
  )

  const runBulk = (
    body: Parameters<typeof bulkAction.mutate>[0],
    describe: (n: number) => string,
  ) => {
    bulkAction.mutate(body, {
      onSuccess: (res) => {
        offerUndo(describe(res.affected), res.undoToken)
        exitSelect()
      },
      onError: () => toast.error('That did not go through. Try again.'),
    })
  }

  const askDelete = (rect: DOMRect) => {
    setTriggerRect(rect)
    bulkPreview.mutate(
      { ids: [...selected], action: 'delete' },
      { onSuccess: setDeletePreview, onError: () => toast.error('Could not prepare that.') },
    )
  }

  const selectedCount = selected.size
  const allSelected = selectedCount > 0 && selectedCount === visible.length

  // The action bar lands in the tab bar's exact slot, so the tab bar slides out
  // for the duration. Two bottom-anchored bars stacked on each other is how you
  // get someone tapping Documents when they meant Delete.
  useClaimTabBarSlot(selectMode)

  return (
    <main className="min-h-dvh pb-28">
      <AppHeader />

      <div className="sticky top-0 z-20 flex flex-col gap-2 bg-canvas/95 px-4 py-4 backdrop-blur">
        <MattersSearchBar
          value={search}
          onValueChange={setSearch}
          onSearched={onSearched}
          onClear={clearSearch}
          searching={false}
          hasResults={Boolean(result)}
        />

        {/* Selection takes over this row rather than adding one: both are a
            single `h-7` line, so entering the mode doesn't shift the list under
            the finger that's about to tap a row. The search box stays — you can
            narrow the list and keep selecting, the way Mail does. */}
        {selectMode ? (
          <SelectionToolbar
            count={selectedCount}
            allSelected={allSelected}
            onSelectAll={() =>
              setSelected(allSelected ? new Set() : new Set(visible.map((t) => t.id)))
            }
            onCancel={exitSelect}
          />
        ) : (
          <div className="flex h-7 items-center gap-1.5">
            <Control
              icon={<ListFilter size={14} />}
              label="Filter"
              active={filtered}
              onClick={(rect) => {
                setTriggerRect(rect)
                setFilterOpen(true)
              }}
            />
            <Control
              icon={<ArrowUpDown size={14} />}
              label="Arrange"
              onClick={(rect) => {
                setTriggerRect(rect)
                setSortOpen(true)
              }}
            />
            <Control
              icon={<Sparkles size={14} />}
              label="Summary"
              onClick={(rect) => {
                setTriggerRect(rect)
                setSummaryOpen(true)
              }}
            />
            <Control
              icon={<CheckSquare size={14} />}
              label="Select"
              onClick={() => setSelectMode(true)}
            />
            {filtered ? (
              <button
                type="button"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS)
                  setSearch('')
                }}
                className="ml-auto shrink-0 text-caption text-accent"
              >
                Clear
              </button>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 px-4 pt-2">


        {result ? (
          <SearchResults
            result={result}
            query={answered ?? ''}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={toggleSelect}
            onOpen={(t, rect) => {
              setTriggerRect(rect)
              setDetailId(t.id)
            }}
            onToggleDone={(t) =>
              completeTask.mutate({ taskId: t.id, done: t.status !== 'done' })
            }
            onClear={clearSearch}
          />
        ) : list.isPending ? (
          <ul className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="size-9 animate-pulse rounded-md bg-surface-sunken" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-sunken" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-surface-sunken" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <EmptyState
            title="Couldn't load your matters."
            body="Check your connection and try again."
          />
        ) : tasks.length === 0 ? (
          // Only a FILTER can empty this list now — typing no longer narrows it,
          // so an unsent question in the box must not be blamed for the list
          // being empty.
          filtered ? (
            <EmptyState
              title="Nothing matches that."
              body="Try loosening a filter."
            />
          ) : (
            <EmptyState
              title="Nothing on your plate."
              body="Anything you capture by chat, voice, or scan lands here."
            />
          )
        ) : (
          <>
            {visibleGroups.map((g) => (
              <section key={g.key} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <span className="text-label uppercase text-accent">{g.label}</span>
                  <span className="text-caption tabular text-ink-subtle">{g.tasks.length}</span>
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-card">
                  {g.tasks.map((task) => (
                    <li key={task.id}>
                      <MatterListRow
                        task={task}
                        selectable={selectMode}
                        selected={selected.has(task.id)}
                        onToggleSelect={toggleSelect}
                        // The detail sheet grows out of the row you tapped, the
                        // same way opening a scanned document does.
                        onOpen={(t, rect) => {
                          setTriggerRect(rect)
                          setDetailId(t.id)
                        }}
                        onToggleDone={(t) =>
                          completeTask.mutate({ taskId: t.id, done: t.status !== 'done' })
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {folded && hidden > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="flex items-center justify-center gap-2 py-1 text-caption text-ink-subtle"
              >
                <span className="h-px flex-1 bg-border" />
                <span className="tabular">{hidden} more</span>
                <span className="h-px flex-1 bg-border" />
              </button>
            ) : null}

            <div ref={sentinel} className="h-4" />
            {list.isFetchingNextPage ? (
              <p className="pb-2 text-center text-caption text-ink-subtle">Loading…</p>
            ) : null}
          </>
        )}
      </div>

      <FilterSheet
        open={filterOpen}
        trigger={triggerRect}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
      />
      <SortSheet
        open={sortOpen}
        trigger={triggerRect}
        onClose={() => setSortOpen(false)}
        sort={sort}
        onSortChange={setSort}
        group={group}
        onGroupChange={setGroup}
      />
      <SummarySheet
        open={summaryOpen}
        trigger={triggerRect}
        onClose={() => setSummaryOpen(false)}
        // Every figure in the summary is a way into the list — tapping one
        // narrows the workspace to exactly those matters. Any search answer on
        // screen is dropped, since the drill-down replaces it.
        onDrillDown={(next) => {
          setResult(null)
          setAnswered(null)
          setSearch('')
          setFilters({ ...DEFAULT_FILTERS, ...next })
          setExpanded(true)
        }}
      />
      <MatterDetailSheet
        task={detail}
        trigger={triggerRect}
        onClose={() => setDetailId(null)}
        onDeleted={(token, title) => offerUndo(`Deleted “${title}”.`, token)}
      />
      <BulkDeleteConfirm
        open={Boolean(deletePreview)}
        preview={deletePreview}
        filters={filters}
        trigger={triggerRect}
        pending={bulkAction.isPending}
        onClose={() => setDeletePreview(null)}
        onConfirm={() => {
          setDeletePreview(null)
          runBulk({ ids: [...selected], action: 'delete' }, (n) =>
            n === 1 ? 'Deleted 1 matter.' : `Deleted ${n} matters.`,
          )
        }}
      />

      <AnimatePresence>
        {selectMode ? (
          <SelectionActionBar
            count={selectedCount}
            busy={bulkAction.isPending || bulkPreview.isPending}
            onComplete={() =>
              runBulk({ ids: [...selected], action: 'complete' }, (n) =>
                n === 1 ? 'Completed 1 matter.' : `Completed ${n} matters.`,
              )
            }
            onSnooze={() =>
              runBulk(
                {
                  ids: [...selected],
                  action: 'snooze',
                  until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                },
                (n) => (n === 1 ? 'Snoozed 1 matter a week.' : `Snoozed ${n} matters a week.`),
              )
            }
            onDelete={askDelete}
          />
        ) : null}
      </AnimatePresence>
    </main>
  )
}

// Hands its own rect to the click handler so the sheet it opens can morph out
// of it, the way the document capture flow grows from its trigger.
function Control({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: (rect: DOMRect) => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => onClick(e.currentTarget.getBoundingClientRect())}
      aria-pressed={active}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-pill border px-2.5 py-1 text-caption transition-colors',
        active
          ? 'border-accent bg-accent/10 text-ink'
          : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <SketchEmptyTrayGlyph />
      <p className="text-body font-medium text-ink">{title}</p>
      <p className="text-caption text-ink-subtle">{body}</p>
    </div>
  )
}
