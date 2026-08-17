'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ListFilter, ArrowUpDown, CalendarRange, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { BulkDeleteConfirm } from '@/components/matters/BulkDeleteConfirm'
import { CategorizeSheet } from '@/components/matters/CategorizeSheet'
import { CreateMatterSheet } from '@/components/matters/CreateMatterSheet'
import { FilterSheet } from '@/components/matters/FilterSheet'
import { MatterDetailSheet } from '@/components/matters/MatterDetailSheet'
import { MatterListRow } from '@/components/matters/MatterListRow'
import { MattersSearchBar } from '@/components/matters/MattersSearchBar'
import { SearchResults } from '@/components/matters/SearchResults'
import { SummarySheet } from '@/components/matters/SummarySheet'
import { SelectionActionBar } from '@/components/matters/SelectionBar'
import { SortSheet, type GroupMode } from '@/components/matters/SortSheet'
import { AppHeader } from '@/components/layout/AppHeader'
import { EmojiChip } from '@/components/ui/EmojiChip'
import { SectionHeaderChip, type ChipTone } from '@/components/ui/SectionHeaderChip'
import { SelectionToolbar } from '@/components/ui/SelectionToolbar'
import { ApiError } from '@/lib/api/client'
import { cn } from '@/lib/cn'
import { LIST_ITEM_VARIANTS } from '@/lib/motion'
import { usePendingProposal, useProposeCategorization } from '@/queries/categorize'
import { useClaimTabBarSlot } from '@/lib/tabBarStore'
import { toast } from '@/lib/toast'
import type { SearchResult } from '@/queries/mattersAi'
import { useDomainLabels } from '@/hooks/useDomainLabels'
import {
  bucketOf,
  groupByDomain,
  groupByPriority,
  groupByTime,
  type TaskGroup,
  type TimeBucket,
} from '@/lib/taskFormat'
import {
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
// Grouping and filtering are lenses. Nothing on this screen ever moves a matter
// somewhere the user can't find it again.

// Group headers are tinted by what the grouping MEANS, so a half-scrolled list
// still tells you where you are. Time buckets walk the day's palette; priority
// buckets borrow the priority tints. Anything else stays neutral.
const GROUP_TONE: Record<string, ChipTone> = {
  overdue: 'high',
  today: 'morning',
  tomorrow: 'afternoon',
  thisWeek: 'evening',
  urgent: 'high',
  high: 'medium',
  low: 'low',
}

function bucketTone(key: string): ChipTone {
  return GROUP_TONE[key] ?? 'anytime'
}

// Hide completed matters by default — a done list is a log, not a workspace.
const DEFAULT_FILTERS: TaskFilters = { status: ['open', 'snoozed'] }

// A matter ticked off during this visit, pinned at the index it occupied when
// the ring was tapped.
interface HeldRow {
  task: Task
  index: number
  /** The bucket it was in before it was ticked — see groupByTime's `pinned`. */
  bucket: TimeBucket
}

// Stable empty identity, so an invalidated hold set doesn't hand `tasks` a new
// array every render.
const NO_HELD_ROWS: HeldRow[] = []

export default function MattersPage() {
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  // The header names the screen, and the tab bar already names it — one word,
  // one key. `nav.matters` is the screen's name everywhere it appears.
  const tNav = useTranslations('nav')
  const domainLabels = useDomainLabels()
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS)
  const [sort, setSort] = useState<TaskSort>('due-asc')
  const [group, setGroup] = useState<GroupMode>('time')
  const [search, setSearch] = useState('')

  const [filterOpen, setFilterOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  // The open matter is held by ID, never as a copy. A copy is a snapshot taken
  // at open time, so adding a step, ticking one off, or deleting one wrote to
  // the server and the cache and left the sheet showing the old subtask list
  // until it was closed and reopened.
  const [detailId, setDetailId] = useState<string | null>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deletePreview, setDeletePreview] = useState<BulkPreview | null>(null)
  const [categorizeOpen, setCategorizeOpen] = useState(false)
  // Captured at tap time: selection mode is exited once the sheet closes, so
  // the sheet's own copy can't read `selected.size` and still be right.
  const [categorizeCount, setCategorizeCount] = useState(0)

  // Each sheet morphs out of whatever opened it, so we hold the rect of the
  // last-tapped control. One slot is enough — only one sheet is ever open.
  const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null)

  // The answer to the last described search. When this is set the page shows
  // the matched matters IN THE ORDER THEY CAME BACK — relevance order is the
  // whole point of a search, so it is deliberately not re-grouped by date.
  const [result, setResult] = useState<SearchResult | null>(null)

  // Typing deliberately does NOT filter.
  //
  // This box takes a description ("anything about renewing next month"), and a
  // description is not a substring of any title — so live-filtering on it wiped
  // the list to an empty state before the search had even run, which reads as
  // "you have nothing" rather than "you haven't asked yet". The list stays put
  // until the question is actually submitted.
  const onSearched = useCallback((res: SearchResult) => {
    setResult(res)
  }, [])

  const clearSearch = useCallback(() => {
    setResult(null)
    setFilters(DEFAULT_FILTERS)
    setSearch('')
  }, [])

  const list = useTasks(filters, sort)
  const counts = useTaskCounts()
  const completeTask = useCompleteTask()
  const bulkPreview = useBulkPreview()
  const bulkAction = useBulkAction()
  const undoBulk = useUndoBulk()
  const proposeCategorization = useProposeCategorization()
  const pendingProposal = usePendingProposal()

  // Matters ticked off during this visit, held at the index they occupied when
  // the ring was tapped.
  //
  // The default filter is status: ['open', 'snoozed'], so the refetch that
  // follows the mutation drops a completed matter and the row vanishes out from
  // under the finger that just completed it — the user gets no confirmation
  // that the tap did what they meant. Holding it lets the row stay put and go
  // struck-through instead. Remembering the INDEX matters: re-appending would
  // slide the row to the end of its section, so the reward for finishing
  // something is watching it travel across the screen.
  // Identifies the current view. Filtering, re-sorting or re-grouping rebuilds
  // the list from scratch, so rows held over from the previous view would
  // resurrect matters the user did not ask to see. Comparing this key DURING
  // RENDER invalidates them without a setState-in-effect and its cascading
  // render. (Search is excluded on purpose: a result set renders through
  // SearchResults, not this list, and clearing one restores the same view.)
  const viewKey = useMemo(() => JSON.stringify({ filters, sort, group }), [filters, sort, group])

  const [held, setHeld] = useState<{ key: string; rows: HeldRow[] }>({ key: viewKey, rows: [] })
  const heldRows = held.key === viewKey ? held.rows : NO_HELD_ROWS

  const holdCompleted = useCallback(
    (task: Task, index: number) => {
      setHeld((prev) => {
        const rows = prev.key === viewKey ? prev.rows : []
        if (rows.some((h) => h.task.id === task.id)) return prev
        return {
          key: viewKey,
          // Bucket captured BEFORE the status flips — afterwards bucketOf()
          // only ever answers 'done'.
          rows: [...rows, { task: { ...task, status: 'done' }, index, bucket: bucketOf(task) }],
        }
      })
    },
    [viewKey],
  )

  const releaseCompleted = useCallback(
    (taskId: string) => {
      setHeld((prev) => ({
        key: viewKey,
        rows: prev.key === viewKey ? prev.rows.filter((h) => h.task.id !== taskId) : [],
      }))
    },
    [viewKey],
  )

  const tasks = useMemo(() => {
    const live = list.data?.pages.flatMap((p) => p.tasks) ?? []
    if (heldRows.length === 0) return live

    const liveIds = new Set(live.map((t) => t.id))
    const merged = [...live]
    // Ascending, so each splice lands before the later ones shift the array.
    for (const { task, index } of [...heldRows].sort((a, b) => a.index - b.index)) {
      if (liveIds.has(task.id)) continue
      merged.splice(Math.min(index, merged.length), 0, task)
    }
    return merged
  }, [list.data, heldRows])
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

  // Only time grouping needs the pin: domain and priority don't change when a
  // matter is completed, so a held row keeps its section there for free.
  const pinnedBuckets = useMemo(
    () => new Map(heldRows.map((h) => [h.task.id, h.bucket])),
    [heldRows],
  )

  const groups: TaskGroup[] = useMemo(() => {
    if (group === 'domain') return groupByDomain(tasks, domainLabels)
    if (group === 'priority') return groupByPriority(tasks, t)
    if (group === 'flat') return [{ key: 'all', label: t('group.allMatters'), tasks }]
    return groupByTime(tasks, t, undefined, pinnedBuckets)
  }, [tasks, group, pinnedBuckets, domainLabels, t])

  const visibleGroups = groups

  // Infinite scroll.
  const sentinel = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const node = sentinel.current
    if (!node || !list.hasNextPage || list.isFetchingNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void list.fetchNextPage()
    })
    io.observe(node)
    return () => io.disconnect()
  }, [list])

  // Completing holds the row in place; reopening releases it back to the live
  // list, where the refetch decides whether it still belongs on screen.
  const toggleDone = useCallback(
    (task: Task) => {
      const done = task.status !== 'done'
      if (done) {
        const at = tasks.findIndex((t) => t.id === task.id)
        holdCompleted(task, at < 0 ? tasks.length : at)
      } else {
        releaseCompleted(task.id)
      }
      completeTask.mutate({ taskId: task.id, done })
    },
    [tasks, holdCompleted, releaseCompleted, completeTask],
  )

  const toggleSelect = useCallback((task: Task) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(task.id)) next.delete(task.id)
      else next.add(task.id)
      return next
    })
  }, [])

  // Entering from a hold starts with THAT row picked. Entering with nothing
  // selected would make the gesture feel like it had only turned a mode on,
  // and leave the action bar disabled under the finger that just held.
  const enterSelect = useCallback((task: Task) => {
    setSelectMode(true)
    setSelected(new Set([task.id]))
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
          label: t('toast.undo'),
          onPress: () =>
            undoBulk.mutate(undoToken, {
              onSuccess: () => toast.info(t('toast.restored')),
              onError: () => toast.error(t('toast.undoFailed')),
            }),
        },
      })
    },
    [undoBulk, t],
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
      onError: () => toast.error(t('toast.actionFailed')),
    })
  }

  // Categorizing is the one bulk action that writes nothing on the way out:
  // it stages a proposal, and the sheet is where the user decides what of it
  // actually lands. Selection mode is left as-is until they have decided —
  // exiting here would drop the set behind the sheet reviewing it.
  const askCategorize = (rect: DOMRect) => {
    setTriggerRect(rect)
    // The sheet opens FIRST, before the model has answered.
    //
    // The round trip takes seconds, and opening on success meant the button
    // appeared to do nothing for the whole of it — the one interaction in the
    // app where the user is most likely to tap again, or give up. The sheet
    // carries its own loading state and, while it waits, is also the only
    // place that explains what this feature does.
    setCategorizeCount(selected.size)
    setCategorizeOpen(true)
    proposeCategorization.mutate(
      { ids: [...selected] },
      {
        onError: (err) => {
          // A proposal is already open — the sheet reads it from the server
          // anyway, so land on it rather than reporting a failure for a state
          // the user can act on.
          if (err instanceof ApiError && err.code === 'categorize_already_open') return
          toast.error(err instanceof ApiError ? err.message : t('toast.readFailed'))
        },
      },
    )
  }

  const askDelete = (rect: DOMRect) => {
    setTriggerRect(rect)
    bulkPreview.mutate(
      { ids: [...selected], action: 'delete' },
      { onSuccess: setDeletePreview, onError: () => toast.error(t('toast.prepareFailed')) },
    )
  }

  const selectedCount = selected.size
  const allSelected = selectedCount > 0 && selectedCount === visible.length

  // The action bar lands in the tab bar's exact slot, so the tab bar slides out
  // for the duration. Two bottom-anchored bars stacked on each other is how you
  // get someone tapping Documents when they meant Delete.
  useClaimTabBarSlot(selectMode)

  return (
    <main className="min-h-dvh pb-32">
      <AppHeader title={tNav('matters')} />

      <div className="sticky top-0 z-20 flex flex-col gap-2.5 bg-canvas/95 px-5 py-4 backdrop-blur-xl">
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
            subjectLabel={tCommon('matters')}
            count={selectedCount}
            allSelected={allSelected}
            onSelectAll={() =>
              setSelected(allSelected ? new Set() : new Set(visible.map((t) => t.id)))
            }
            onCancel={exitSelect}
          />
        ) : (
          /* The pill row scrolls rather than shrinking: four labelled pills do
             not fit a 390px screen, and unlabelled icons would make "Arrange"
             and "Filter" indistinguishable from each other. */
          <div className="flex items-center gap-2">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <Control
              icon={<ListFilter size={15} />}
              label={t('controls.filter')}
              active={filtered}
              onClick={(rect) => {
                setTriggerRect(rect)
                setFilterOpen(true)
              }}
            />
            <Control
              icon={<ArrowUpDown size={15} />}
              label={t('controls.arrange')}
              onClick={(rect) => {
                setTriggerRect(rect)
                setSortOpen(true)
              }}
            />
            <Control
              icon={<CalendarRange size={15} />}
              label={t('controls.summary')}
              onClick={(rect) => {
                setTriggerRect(rect)
                setSummaryOpen(true)
              }}
            />
            {/* No "Select" pill.
                Four labelled pills do not fit a 390px screen, so it lived at
                the end of the scroll and was invisible unless you thought to
                drag the row sideways — a control nobody can find is not a
                control. Selection is entered by pressing and holding a row,
                which is how /documents has always done it. */}
            </div>

            {/* There is deliberately no "Clear" button here. It was a third
                way to say the same thing — the Filter pill already goes coral
                when filters are on, and the sheet it opens owns "Clear all".
                Sitting outside the scroll container, it also butted straight
                up against whichever pill the row happened to clip, so the
                control row read as broken rather than as scrollable. */}

            {/* Outside the scrolling pill row, so the way to add a matter is
                never scrolled off the screen. Near-black: this is the primary
                action of the workspace, and the coral is spoken for by live
                state. */}
            <button
              type="button"
              aria-label={t('controls.addMatter')}
              onClick={(e) => {
                setTriggerRect(e.currentTarget.getBoundingClientRect())
                setCreateOpen(true)
              }}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-solid text-solid-ink transition-transform active:scale-95"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6 px-5 pt-2">
        {/* Slipped matters get one calm, bounded prompt — never a red count
            badge. "3 slipped" is actionable; "62 overdue" is just shame, and
            shame is what makes people stop opening the app. Hidden while an
            answer or a filter is on screen, so it can't compete with the thing
            the user actually asked for. */}
        {!filtered && !result && (counts.data?.slipping ?? 0) > 0 ? (
          <button
            type="button"
            onClick={() => setFilters({ ...DEFAULT_FILTERS, overdue: true })}
            className="flex items-center gap-3.5 rounded-2xl bg-accent-soft px-4 py-3.5 text-start"
          >
            <EmojiChip emoji="🌾" category="peach" size={40} />
            <span className="min-w-0 flex-1 text-body text-ink">
              {t.rich('slipping.prompt', {
                count: counts.data?.slipping ?? 0,
                b: (chunks: React.ReactNode) => (
                  <span className="font-bold tabular">{chunks}</span>
                ),
              })}
            </span>
            <ArrowRight size={17} className="shrink-0 text-accent" />
          </button>
        ) : null}

        {result ? (
          <SearchResults
            result={result}
            selectMode={selectMode}
            selected={selected}
            onToggleSelect={toggleSelect}
            onOpen={(t, rect) => {
              setTriggerRect(rect)
              setDetailId(t.id)
            }}
            onToggleDone={toggleDone}
            onLongPress={enterSelect}
            onClear={clearSearch}
          />
        ) : list.isPending ? (
          <ul className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
              >
                <div className="size-11 animate-pulse rounded-full bg-surface-sunken" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="h-4 w-2/3 animate-pulse rounded-pill bg-surface-sunken" />
                  <div className="h-3 w-1/3 animate-pulse rounded-pill bg-surface-sunken" />
                </div>
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <EmptyState title={t('empty.loadFailed')} body={t('empty.loadFailedBody')} />
        ) : tasks.length === 0 ? (
          // Only a FILTER can empty this list now — typing no longer narrows it,
          // so an unsent question in the box must not be blamed for the list
          // being empty.
          filtered ? (
            <EmptyState title={t('empty.noMatch')} body={t('empty.noMatchBody')} />
          ) : (
            <EmptyState title={t('empty.none')} body={t('empty.noneBody')} />
          )
        ) : (
          <>
            {visibleGroups.map((g) => (
              <section key={g.key} className="flex flex-col gap-3">
                <SectionHeaderChip
                  label={g.label}
                  tone={bucketTone(g.key)}
                  count={g.tasks.length}
                  className="self-start"
                />
                {/* `layout="position"` on every row is what makes completing,
                    deleting, re-sorting and re-grouping slide instead of jump —
                    a row that moves animates to its new slot, and the rows
                    below close the gap left by one that exits. AnimatePresence
                    with initial={false} so arriving on the screen doesn't play
                    the insert animation for the whole backlog at once. */}
                <ul className="flex flex-col gap-3">
                  <AnimatePresence initial={false}>
                    {g.tasks.map((task) => (
                      <motion.li
                        key={task.id}
                        layout="position"
                        variants={LIST_ITEM_VARIANTS}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                      >
                        <MatterListRow
                          task={task}
                          selectable={selectMode}
                          selected={selected.has(task.id)}
                          onToggleSelect={toggleSelect}
                          // The detail sheet grows out of the row you tapped,
                          // the same way opening a scanned document does.
                          onOpen={(t, rect) => {
                            setTriggerRect(rect)
                            setDetailId(t.id)
                          }}
                          onToggleDone={toggleDone}
                          onLongPress={enterSelect}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </section>
            ))}

            <div ref={sentinel} className="h-4" />
            {list.isFetchingNextPage ? (
              <p className="pb-2 text-center text-caption text-ink-subtle">
                {t('list.loadingMore')}
              </p>
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
          setSearch('')
          setFilters({ ...DEFAULT_FILTERS, ...next })
        }}
      />
      <MatterDetailSheet
        task={detail}
        trigger={triggerRect}
        onClose={() => setDetailId(null)}
        onDeleted={(token, title) => offerUndo(t('toast.deletedOne', { title }), token)}
      />
      <CreateMatterSheet
        open={createOpen}
        trigger={triggerRect}
        onClose={() => setCreateOpen(false)}
      />
      {/* Reads the proposal from the server rather than from the mutation's
          result, so one left open survives a reload and reopens where it was. */}
      <CategorizeSheet
        open={categorizeOpen}
        loading={proposeCategorization.isPending}
        failed={proposeCategorization.isError && !pendingProposal.data}
        selectedCount={categorizeCount}
        proposal={pendingProposal.data ?? null}
        trigger={triggerRect}
        onClose={() => {
          setCategorizeOpen(false)
          exitSelect()
        }}
        onApplied={(applied, undoToken) => {
          offerUndo(t('toast.refiled', { count: applied }), undoToken)
          exitSelect()
        }}
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
            t('toast.deleted', { count: n }),
          )
        }}
      />

      <AnimatePresence>
        {selectMode ? (
          <SelectionActionBar
            count={selectedCount}
            busy={bulkAction.isPending || bulkPreview.isPending || proposeCategorization.isPending}
            onComplete={() =>
              runBulk({ ids: [...selected], action: 'complete' }, (n) =>
                t('toast.completed', { count: n }),
              )
            }
            onSnooze={() =>
              runBulk(
                {
                  ids: [...selected],
                  action: 'snooze',
                  until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
                },
                (n) => t('toast.snoozedWeek', { count: n }),
              )
            }
            onCategorize={askCategorize}
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
        'flex h-10 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-body-sm font-bold transition-colors active:scale-[0.98]',
        active ? 'bg-accent text-accent-ink' : 'bg-surface-field text-ink hover:brightness-[0.97]',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <SketchEmptyTrayGlyph />
      <p className="mt-2 font-display text-heading-serif text-ink">{title}</p>
      <p className="max-w-[32ch] text-body text-ink-muted">{body}</p>
    </div>
  )
}
