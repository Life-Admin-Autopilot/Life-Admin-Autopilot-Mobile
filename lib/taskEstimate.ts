import type { Translate } from '@/lib/i18n/translate'
import type { Task } from '@/queries/tasks'

// AI-estimated time windows.
//
// The estimate is deliberately a bucketed RANGE, not a number of minutes. It is
// a guess produced by a language model from a task title, and presenting "23
// minutes" would claim a precision that does not exist. A range renders as
// "20–30m" and reads, correctly, as approximate.
//
// Every consumer must survive the field being absent: it is optional on the
// model, and every task created before estimates existed will not have one.
export interface TaskEstimate {
  minMinutes: number
  maxMinutes: number
  source: 'ai' | 'user'
}

// Structural read rather than `task.estimate`. The field is being added to the
// Task type in a parallel workstream; reading it this way compiles both before
// and after that lands, and stays correct afterwards.
export function estimateOf(task: Task): TaskEstimate | undefined {
  const value = (task as Task & { estimate?: TaskEstimate }).estimate
  if (!value) return undefined
  if (typeof value.minMinutes !== 'number' || typeof value.maxMinutes !== 'number') return undefined
  return value
}

// The keys this module reads, scoped to the `lib` namespace. Callers pass
// `useTranslations('lib')` — see lib/i18n/translate.ts for why the translator
// arrives as an argument rather than a hook call in here.
//
// The unit forms are ICU plurals rather than `${n}m`. English collapses to a
// single `other` body ("45m"), but Arabic selects across six categories and
// "دقيقتان" is not "2 دقيقة" — a template literal cannot express that, and
// neither can a ternary.
export type EstimateKey =
  | 'estimate.minutes'
  | 'estimate.hours'
  | 'estimate.hoursAndMinutes'
  | 'estimate.approx'
  | 'estimate.range'
  | 'estimate.about'

function formatMinutes(total: number, t: Translate<EstimateKey>): string {
  if (total < 60) return t('estimate.minutes', { count: total })
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (minutes === 0) return t('estimate.hours', { count: hours })
  // Composed from the two unit messages rather than one "{h}h {m}m" template:
  // both halves inflect independently in Arabic, and the joiner differs too
  // (a bare space in English, the conjunction و in Arabic).
  return t('estimate.hoursAndMinutes', {
    hours: t('estimate.hours', { count: hours }),
    minutes: t('estimate.minutes', { count: minutes }),
  })
}

/** Row label: "≈20m", or "20–45m" when the window is genuinely wide. */
export function formatEstimate(
  estimate: TaskEstimate | undefined,
  t: Translate<EstimateKey>,
): string | undefined {
  if (!estimate) return undefined
  const { minMinutes, maxMinutes } = estimate
  if (minMinutes === maxMinutes) {
    return t('estimate.approx', { duration: formatMinutes(minMinutes, t) })
  }
  // A window wider than 2× is not usefully summarised by its midpoint — a
  // "15–60m" task and a "35m" task are not the same thing to plan around.
  if (maxMinutes >= minMinutes * 2) {
    return t('estimate.range', { min: minMinutes, max: formatMinutes(maxMinutes, t) })
  }
  const mid = Math.round((minMinutes + maxMinutes) / 2)
  return t('estimate.approx', { duration: formatMinutes(mid, t) })
}

/**
 * Total load across a set of tasks. Returns null when nothing is estimated —
 * the caller must then say nothing rather than claim "about 0m", which would
 * read as "you have nothing to do" when the truth is "we don't know yet".
 */
export function totalLoad(tasks: Task[]): { min: number; max: number } | null {
  let min = 0
  let max = 0
  let counted = 0
  for (const task of tasks) {
    const estimate = estimateOf(task)
    if (!estimate) continue
    min += estimate.minMinutes
    max += estimate.maxMinutes
    counted += 1
  }
  if (counted === 0) return null
  return { min, max }
}

/** "about 2h" / "1h 30m–2h 15m" — the day's shape in one phrase. */
export function formatLoad(
  load: { min: number; max: number } | null,
  t: Translate<EstimateKey>,
): string | undefined {
  if (!load) return undefined
  if (load.min === load.max) {
    return t('estimate.about', { duration: formatMinutes(load.min, t) })
  }
  // Round to the nearest quarter hour above an hour: the sum of a dozen rough
  // guesses does not deserve minute-level presentation.
  const round = (n: number) => (n >= 60 ? Math.round(n / 15) * 15 : n)
  return t('estimate.range', {
    min: formatMinutes(round(load.min), t),
    max: formatMinutes(round(load.max), t),
  })
}
