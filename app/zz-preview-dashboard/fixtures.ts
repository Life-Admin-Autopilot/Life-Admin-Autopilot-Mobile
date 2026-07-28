import type { DashboardViewProps } from '@/components/dashboard/DashboardView'
import type { DailyDigest } from '@/queries/digest'
import type { Task } from '@/queries/tasks'

// Fixtures for the dashboard preview route. Dev-only — nothing here ships in a
// user-visible path, and no production module imports it.
//
// Times are all expressed as offsets from a `now` handed in by the caller, so
// every state stays truthful no matter when the page is opened. Hard-coded ISO
// strings would silently rot into "3 months overdue" overnight and quietly stop
// testing the thing they were written to test.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

interface TaskSeed {
  id: string
  title: string
  domain: Task['domain']
  /** Offset from `now`, ms. Negative is overdue. */
  dueIn?: number
  priority?: Task['priority']
  estimate?: [number, number]
  subtasks?: { text: string; done: boolean }[]
}

function task(seed: TaskSeed, now: Date): Task {
  const created = new Date(now.getTime() - 3 * DAY).toISOString()
  return {
    id: seed.id,
    title: seed.title,
    domain: seed.domain,
    kind: seed.dueIn === undefined ? 'list' : 'reminder',
    status: 'open',
    priority: seed.priority ?? 'normal',
    priorityRank: 2,
    tags: [],
    subtasks: (seed.subtasks ?? []).map((s, i) => ({
      id: `${seed.id}-s${i}`,
      text: s.text,
      done: s.done,
    })),
    reminders: [],
    dueAt: seed.dueIn === undefined ? undefined : new Date(now.getTime() + seed.dueIn).toISOString(),
    rescheduleCount: 0,
    createdAt: created,
    updatedAt: created,
    ...(seed.estimate
      ? { estimate: { minMinutes: seed.estimate[0], maxMinutes: seed.estimate[1], source: 'ai' } }
      : {}),
  } as Task
}

function digest(overrides: Partial<DailyDigest> = {}, now: Date = new Date()): DailyDigest {
  return {
    localDate: now.toISOString().slice(0, 10),
    generatedAt: now.toISOString(),
    headline: 'Three bills land this week, and the car insurance renewal is the big one.',
    counts: {
      dueToday: 4,
      completedToday: 2,
      openTotal: 21,
      slipping: 2,
      needsInput: 4,
      scansAwaitingReview: 1,
    },
    estimatedMinutesToday: { min: 75, max: 130 },
    themes: [
      { label: 'Car insurance', count: 3, taskIds: [] },
      { label: 'Home utilities', count: 4, taskIds: [] },
      { label: 'Health appointments', count: 2, taskIds: [] },
    ],
    busiestDay: { date: new Date(now.getTime() + 2 * DAY).toISOString(), count: 5 },
    duplicates: [{ title: 'Pay electricity bill', count: 2, taskIds: [] }],
    ...overrides,
  }
}

export interface PreviewState {
  slug: string
  label: string
  /** What this state is for — shown above the frame so the check is deliberate. */
  note: string
  build: (now: Date) => Omit<
    DashboardViewProps,
    'onComplete' | 'onCompleteSubtask' | 'onPush' | 'now'
  >
}

const BASE = {
  name: 'Mina',
  loaded: true,
  completedToday: 2,
  needsInput: 0,
  scansAwaitingReview: 0,
  slipping: 0,
  digest: undefined,
} satisfies Omit<DashboardViewProps, 'onComplete' | 'onCompleteSubtask' | 'onPush' | 'now' | 'openTasks'>

export const PREVIEW_STATES: PreviewState[] = [
  {
    slug: 'loading',
    label: 'Loading',
    note: 'Must NOT claim the day is clear before the list has resolved.',
    build: () => ({ ...BASE, loaded: false, completedToday: 0, openTasks: [] }),
  },
  {
    slug: 'first-run',
    label: 'Brand new account',
    note: 'Nothing ever added. Must NOT say "rest" and must offer a way in.',
    build: () => ({ ...BASE, completedToday: 0, openTasks: [] }),
  },
  {
    slug: 'clear-day',
    label: 'Clear day',
    note: 'The target calm state. No CTA, no "+", screen gets quieter not louder.',
    build: () => ({ ...BASE, completedToday: 4, openTasks: [] }),
  },
  {
    slug: 'clear-day-with-inbox',
    label: 'Clear day + inbox',
    note: 'Nothing due, but work is still blocked on the user.',
    build: () => ({
      ...BASE,
      completedToday: 4,
      openTasks: [],
      needsInput: 4,
      scansAwaitingReview: 2,
    }),
  },
  {
    slug: 'single-simple',
    label: 'One matter, no subtasks',
    note: 'Headline is the matter itself; CTA completes it.',
    build: (now) => ({
      ...BASE,
      openTasks: [
        task(
          { id: 't1', title: 'Pay the electricity bill', domain: 'home', dueIn: 5 * HOUR, estimate: [10, 15] },
          now,
        ),
      ],
    }),
  },
  {
    slug: 'single-subtasks',
    label: 'One matter, with subtasks',
    note: 'Headline becomes the NEXT STEP; matter title drops to the eyebrow.',
    build: (now) => ({
      ...BASE,
      openTasks: [
        task(
          {
            id: 't2',
            title: 'Renew the car insurance policy',
            domain: 'car',
            dueIn: 7 * HOUR,
            priority: 'high',
            estimate: [30, 60],
            subtasks: [
              { text: 'Find last year’s policy number', done: false },
              { text: 'Compare three quotes', done: false },
              { text: 'Pay and save the certificate', done: false },
            ],
          },
          now,
        ),
      ],
    }),
  },
  {
    slug: 'due-imminent',
    label: 'Due in 40 minutes',
    note: 'Meter should be nearly drained and coral. The urgency case.',
    build: (now) => ({
      ...BASE,
      openTasks: [
        task(
          { id: 't3', title: 'Attend the dental appointment', domain: 'health', dueIn: 40 * MINUTE, estimate: [45, 60] },
          now,
        ),
      ],
    }),
  },
  {
    slug: 'overdue',
    label: 'Overdue',
    note: 'Must read warm, never red. No shame framing anywhere on the screen.',
    build: (now) => ({
      ...BASE,
      slipping: 3,
      openTasks: [
        task(
          { id: 't4', title: 'Pay the overdue veterinary bill', domain: 'pets', dueIn: -17 * DAY, priority: 'urgent', estimate: [10, 15] },
          now,
        ),
      ],
    }),
  },
  {
    slug: 'full-day',
    label: 'Busy day',
    note: 'Focus + 3 rows + overflow link + summed load. The dense case.',
    build: (now) => ({
      ...BASE,
      needsInput: 4,
      scansAwaitingReview: 1,
      slipping: 2,
      digest: digest({}, now),
      openTasks: [
        task({ id: 'b1', title: 'Pay the electricity bill', domain: 'home', dueIn: 3 * HOUR, priority: 'urgent', estimate: [10, 15] }, now),
        task({ id: 'b2', title: 'Send proof of no-claims discount', domain: 'car', dueIn: 5 * HOUR, priority: 'high', estimate: [15, 30] }, now),
        task({ id: 'b3', title: 'Book the pet vaccination', domain: 'pets', dueIn: 8 * HOUR, estimate: [10, 10] }, now),
        task({ id: 'b4', title: 'Return the school enrolment form', domain: 'family', dueIn: 9 * HOUR, estimate: [30, 45] }, now),
        task({ id: 'b5', title: 'Arrange the boiler annual service', domain: 'home', dueIn: 10 * HOUR, estimate: [15, 30] }, now),
        task({ id: 'b6', title: 'Renew the vehicle test certificate', domain: 'car', dueIn: 11 * HOUR }, now),
      ],
    }),
  },
  {
    slug: 'no-estimates',
    label: 'No estimates',
    note: 'Older matters have no AI window — the load line must simply vanish.',
    build: (now) => ({
      ...BASE,
      openTasks: [
        task({ id: 'n1', title: 'Pay the electricity bill', domain: 'home', dueIn: 3 * HOUR }, now),
        task({ id: 'n2', title: 'Book the pet vaccination', domain: 'pets', dueIn: 6 * HOUR }, now),
      ],
    }),
  },
  {
    slug: 'long-text',
    label: 'Long titles',
    note: 'Truncation and wrapping under hostile content.',
    build: (now) => ({
      ...BASE,
      needsInput: 12,
      scansAwaitingReview: 7,
      slipping: 23,
      openTasks: [
        task(
          {
            id: 'l1',
            title:
              'Renew the comprehensive household contents and buildings insurance policy before the introductory discount period expires',
            domain: 'home',
            dueIn: 2 * HOUR,
            priority: 'urgent',
            estimate: [60, 120],
            subtasks: [
              {
                text: 'Locate the original policy schedule and the renewal invitation letter that arrived last week',
                done: false,
              },
            ],
          },
          now,
        ),
        task(
          {
            id: 'l2',
            title:
              'Send the completed proof of no-claims discount documentation to the new insurer',
            domain: 'car',
            dueIn: 6 * HOUR,
          },
          now,
        ),
      ],
    }),
  },
  {
    slug: 'digest-only',
    label: 'Digest with substance',
    note: 'Themes, heaviest day, duplicates. The card must earn its space.',
    build: (now) => ({
      ...BASE,
      completedToday: 4,
      openTasks: [],
      digest: digest({}, now),
    }),
  },
  {
    slug: 'digest-empty',
    label: 'Digest with nothing to add',
    note: 'No themes, no busy day, no duplicates → the card must NOT render at all.',
    build: (now) => ({
      ...BASE,
      completedToday: 4,
      openTasks: [],
      digest: digest({ themes: [], busiestDay: null, duplicates: [], headline: 'Nothing due today.' }, now),
    }),
  },
]
