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

function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Row label: "≈20m", or "20–45m" when the window is genuinely wide. */
export function formatEstimate(estimate: TaskEstimate | undefined): string | undefined {
  if (!estimate) return undefined
  const { minMinutes, maxMinutes } = estimate
  if (minMinutes === maxMinutes) return `≈${formatMinutes(minMinutes)}`
  // A window wider than 2× is not usefully summarised by its midpoint — a
  // "15–60m" task and a "35m" task are not the same thing to plan around.
  if (maxMinutes >= minMinutes * 2) return `${minMinutes}–${formatMinutes(maxMinutes)}`
  const mid = Math.round((minMinutes + maxMinutes) / 2)
  return `≈${formatMinutes(mid)}`
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

/** "about 2h" / "1h 30m – 2h 15m" — the day's shape in one phrase. */
export function formatLoad(load: { min: number; max: number } | null): string | undefined {
  if (!load) return undefined
  if (load.min === load.max) return `about ${formatMinutes(load.min)}`
  // Round to the nearest quarter hour above an hour: the sum of a dozen rough
  // guesses does not deserve minute-level presentation.
  const round = (n: number) => (n >= 60 ? Math.round(n / 15) * 15 : n)
  return `${formatMinutes(round(load.min))}–${formatMinutes(round(load.max))}`
}
