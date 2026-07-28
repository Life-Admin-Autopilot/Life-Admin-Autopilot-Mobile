// Every knob the demo seed turns. Nothing else in seed-demo/ hardcodes a
// volume, a date or a persona detail — change it here and re-run.

export const SEED_EMAIL = 'minamelad232@gmail.com'

// The persona lives in Cairo. This is load-bearing, not cosmetic: the digest
// and the Matters time buckets are computed against local midnight, so a
// dataset generated in the wrong zone puts "due today" on the wrong day.
export const TIMEZONE = 'Africa/Cairo'
export const CURRENCY = 'EGP'
export const DISPLAY_NAME = 'Mina'

// Three years back from roughly now. The account's own createdAt is moved here
// too — a user with three years of matters who signed up last May is a story
// that falls apart the moment anyone looks at the profile.
export const HISTORY_START = '2023-08-01T00:00:00.000Z'

// How far past `now` the recurring spine keeps emitting. Enough to fill the
// "later" bucket and the week-ahead view without inventing a fictional future.
export const FUTURE_HORIZON_DAYS = 90

// Fixed so a re-run reproduces the identical dataset. Override with --seed.
export const DEFAULT_SEED = 20260728

// Historical one-off volume. The recurring spine contributes ~570 on its own,
// so this is the number that decides the total.
export const ONE_OFF_TOTAL = 900

// The live backlog, bucket by bucket. These are exact counts, not targets:
// the whole point is that every group header on /matters has something under
// it, and that the dashboard is neither empty nor a wall of overdue shame.
export const LIVE_BUCKETS = {
  /** Past due but not yet slipping. */
  overdue: 5,
  today: 6,
  tomorrow: 5,
  thisWeek: 15,
  /** Beyond this week, with a date. */
  later: 24,
  /** No date at all — these are `kind: 'list'`. */
  noDate: 14,
  snoozed: 6,
} as const

// Matters deliberately left to rot so the "N matters have slipped" nudge and
// the digest's `slipping` count point at something real. Either 14+ days
// overdue or moved 3+ times — the rule taskCounts and dailyDigest share.
export const SLIPPING_COUNT = 4

export const VOLUMES = {
  voiceNotes: 180,
  documents: 90,
  clarifications: 140,
  notifications: 400,
  /** Capped at AI_CONVERSATION_MAX_TURNS (50) by the model. */
  conversationTurns: 40,
} as const

// What stays unresolved on purpose, so the surfaces that exist to show
// unresolved things aren't empty.
export const PENDING = {
  /** ScannedDocuments in ready_for_review with no reviewedAt. */
  scansAwaitingReview: 3,
  /** Open Clarifications — the /uncertainties stack and the home banner. */
  openClarifications: 5,
  /** Unread Notifications — the bell's count. */
  unreadNotifications: 6,
  /** VoiceNotes parked in needs_review. */
  voiceNotesNeedingReview: 4,
} as const

// What happened to matters whose deadline has passed.
//
// Note what ISN'T here: a rate for "left open". A diligent user's three-year
// archive that leaves even 2% of 1,400 matters open would put ~28 rows under
// the overdue header, and /matters is explicit that a big overdue count reads
// as shame rather than as work. Every overdue and slipping matter in this
// dataset is placed deliberately by LIVE_BUCKETS instead, so the number on
// screen is exactly the number chosen.
export const COMPLETION = {
  /** Closed. The rest were binned. */
  doneRate: 0.965,
  /** Of the completed ones, the share closed before the deadline. */
  earlyRate: 0.78,
} as const

// Written next to the script so --purge can undo exactly this run.
export const MANIFEST_FILE = 'scripts/seed-demo/.last-run.json'
