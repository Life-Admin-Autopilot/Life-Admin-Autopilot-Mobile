'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { DayProgress } from '@/components/dashboard/DayProgress'
import { FirstRunState } from '@/components/dashboard/FirstRunState'
import { BriefingCard } from '@/components/dashboard/BriefingCard'
import { MoneyCard } from '@/components/dashboard/MoneyCard'
import { HomeHero } from '@/components/dashboard/HomeHero'
import { MatterRow } from '@/components/dashboard/MatterRow'
import { NeedsYouStrip } from '@/components/dashboard/NeedsYouStrip'
import { RightNowCard } from '@/components/dashboard/RightNowCard'
import { SectionHeaderChip } from '@/components/ui/SectionHeaderChip'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { bucketOf, formatDue } from '@/lib/taskFormat'
import { formatLoad, totalLoad } from '@/lib/taskEstimate'
import type { DailyDigest } from '@/queries/digest'
import type { Subtask, Task } from '@/queries/tasks'

// The home screen answers ONE question: what needs me right now?
//
// It used to answer "how much do I have?" — three counts and a preview list.
// That is an inventory, and an inventory that only grows is a scoreboard the
// user is permanently losing. Everything here is ordered by that reframing:
// the single next thing first, the rest of today capped at a glance, then the
// work that is blocked on the user, then the week's shape.
//
// Deliberately capped. Surfacing one next step beats surfacing a ranked
// backlog, because a backlog still leaves the choosing to the user — and the
// choosing is the step that stalls.
//
// PURELY PRESENTATIONAL. Every input arrives as a prop so this exact tree can
// be rendered against fixtures in /zz-preview-dashboard. A preview that
// rebuilds the layout by hand is a preview that lies the first time the real
// screen changes; this one cannot drift because it IS the real screen.
const REST_OF_DAY_ROWS = 3

export interface DashboardViewProps {
  name: string
  now: Date
  /** Open matters, soonest-due first. */
  openTasks: Task[]
  /** False while the list is still loading — gates the "day is clear" claim. */
  loaded: boolean
  completedToday: number
  needsInput: number
  scansAwaitingReview: number
  slipping: number
  /** False while the counts are in flight — the strip shows placeholders. */
  countsLoaded?: boolean
  digest?: DailyDigest
  busy?: boolean
  onComplete: (task: Task) => void
  onCompleteSubtask: (task: Task, subtask: Subtask) => void
  onPush: (task: Task) => void
  /**
   * Open a matter's detail sheet, passing the tapped element's rect so the sheet
   * can morph out of it. OPTIONAL on purpose: /zz-preview-dashboard renders this
   * tree against fixtures with no query client behind it, and the detail sheet
   * mutates. Omitted, the rows fall back to linking to /matters.
   */
  onOpenTask?: (task: Task, rect: DOMRect) => void
}

export function DashboardView({
  name,
  now,
  openTasks,
  loaded,
  completedToday,
  needsInput,
  scansAwaitingReview,
  slipping,
  countsLoaded = true,
  digest,
  busy = false,
  onComplete,
  onCompleteSubtask,
  onPush,
  onOpenTask,
}: DashboardViewProps) {
  const t = useTranslations('dashboard')
  // formatDue reads `due.*` out of the matters catalogue, not this one — the
  // due-date vocabulary is shared with the workspace and must not fork.
  const tMatters = useTranslations('matters')
  const tLib = useTranslations('lib')
  const tag = useIntlTag()
  // Today's plate is what is due today PLUS what already slipped — a matter
  // that was due yesterday is still today's problem, and hiding it under a
  // separate heading is how it stays unhandled.
  const onThePlate = openTasks.filter((task) => {
    const bucket = bucketOf(task, now)
    return bucket === 'overdue' || bucket === 'today'
  })

  const focus: Task | undefined = onThePlate[0]
  const rest = onThePlate.slice(1, 1 + REST_OF_DAY_ROWS)
  const remaining = Math.max(0, onThePlate.length - 1 - rest.length)
  const load = formatLoad(totalLoad(onThePlate), tLib)

  // Only claim the day is clear once we actually know. Rendering "nothing
  // needs you" while the list is still loading is a lie the user acts on.
  const clearDay = loaded && onThePlate.length === 0

  // An empty ACCOUNT is not a clear DAY, and the two must never share copy.
  // "Rest, you're caught up" to someone who has never added anything is
  // meaningless — they have nothing to be caught up on — and it implies the app
  // is already working when it has nothing to work with. Nothing open, nothing
  // finished today, and nothing waiting is as close to "brand new" as the
  // dashboard can see without asking the server.
  // `needsInput` is deliberately NOT part of this test any more. An open
  // question now always has a real task behind it, so `openTasks.length`
  // already accounts for it — and when a question was the ONLY thing on file,
  // gating on it used to keep a genuinely empty account out of its welcome
  // state forever, because nothing the user could do would ever clear it.
  // Gated on countsLoaded for the same reason clearDay is gated on loaded: two
  // of these three figures now arrive from the counts request, and a zero that
  // only means "not back yet" would flash the brand-new-account welcome at
  // someone with a full account.
  const firstRun =
    countsLoaded &&
    clearDay &&
    openTasks.length === 0 &&
    completedToday === 0 &&
    scansAwaitingReview === 0

  // A clear day writes its own sentence into the digest's slot rather than
  // adding a second one below it. Two lines of reassurance stacked around a
  // progress pill read as the app repeating itself to fill space — and the
  // whole point of a clear day is that there is less on the screen, not more.
  const summary = firstRun
    ? t('summary.firstRun', { name })
    : clearDay
      ? t('summary.clearDay', { name })
      : digest?.headline

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-5">
      <HomeHero
        name={name}
        now={now}
        summary={summary}
        progress={<DayProgress done={completedToday} total={completedToday + onThePlate.length} />}
      />

      {firstRun ? <FirstRunState /> : null}

      {/* Below the hero, above the plate: it frames the day the rows then detail. */}
      <BriefingCard />

      {/* The only way into /money — the tab bar is full at five slots. It renders
          nothing until there is a real figure, so it costs an empty account no
          vertical space above the day's matters. */}
      <MoneyCard />

      {focus ? (
        <>
          <RightNowCard
            task={focus}
            busy={busy}
            onComplete={onComplete}
            onCompleteSubtask={onCompleteSubtask}
            onPush={onPush}
            onOpen={onOpenTask}
          />

          {rest.length > 0 ? (
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <SectionHeaderChip
                  label={t('alsoToday.title')}
                  tone="morning"
                  count={onThePlate.length - 1}
                />
                {load ? (
                  <span className="text-body-sm text-ink-muted">
                    {t('alsoToday.load', { load })}
                  </span>
                ) : null}
              </div>

              {/* Tapping a row opens the matter in place, the same detail sheet
                  the workspace uses. It used to navigate to /matters, which
                  answered a question the user had not asked — they tapped THIS
                  matter, not "show me all of them" — and lost the dashboard's
                  scroll position on the way. `onOpenTask` is optional, so the
                  preview route keeps the old link behaviour with no wiring. */}
              {rest.map((task) =>
                onOpenTask ? (
                  <button
                    key={task.id}
                    type="button"
                    onClick={(e) => onOpenTask(task, e.currentTarget.getBoundingClientRect())}
                    className="block w-full text-start"
                  >
                    <MatterRow
                      domain={task.domain}
                      title={task.title}
                      due={formatDue(task.dueAt, { t: tMatters, tag, now })}
                      overdue={bucketOf(task, now) === 'overdue'}
                    />
                  </button>
                ) : (
                  <Link key={task.id} href="/matters" className="block">
                    <MatterRow
                      domain={task.domain}
                      title={task.title}
                      due={formatDue(task.dueAt, { t: tMatters, tag, now })}
                      overdue={bucketOf(task, now) === 'overdue'}
                    />
                  </Link>
                ),
              )}

              {remaining > 0 ? (
                <Link
                  href="/matters"
                  className="self-center rounded-pill px-3 py-1.5 text-body-sm font-bold text-accent hover:bg-accent-soft"
                >
                  {t('alsoToday.more', { count: remaining })}
                </Link>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}

      <NeedsYouStrip
        needsInput={needsInput}
        scansAwaitingReview={scansAwaitingReview}
        slipping={slipping}
        loaded={countsLoaded}
      />
    </div>
  )
}
