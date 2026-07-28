'use client'

import { Check, Clock } from 'lucide-react'

import { DomainIcon } from '@/components/icons/DomainIcon'
import { Button } from '@/components/ui/button'
import { DeadlineMeter, TimeUntil } from '@/components/ui/DeadlineMeter'
import { Pill } from '@/components/ui/Pill'
import { estimateOf, formatEstimate } from '@/lib/taskEstimate'
import type { Subtask, Task } from '@/queries/tasks'

/**
 * The one thing. The centre of the home screen and the answer to the only
 * question a home screen should answer: *what needs me right now?*
 *
 * Deliberately singular. A list of everything is what the workspace is for;
 * surfacing one next step beats surfacing a ranked backlog, because a backlog
 * still leaves the choosing to the user — and the choosing is the step that
 * stalls. N equally-weighted options hand the hardest executive function back
 * to the person who opened the app to avoid exactly that.
 *
 * WHEN THE MATTER HAS SUBTASKS, THE HEADLINE IS THE NEXT SUBTASK, not the
 * matter. Task initiation is a distinct failure point from planning: "renew the
 * car insurance" is a project you can stare at for a week, "find the policy
 * number" is a thing you can do now. The matter's title drops to an eyebrow so
 * the context survives without being the ask. The primary button always
 * completes whatever the headline names, so the two never disagree.
 *
 * Both actions matter equally, and the second is not an afterthought: "Not
 * today" lets the plan be abandoned without a cleanup ritual. An app that only
 * offers "done" makes every unfinished day an accumulating debt, and the debt
 * is what stops people opening it again.
 */
export function RightNowCard({
  task,
  onComplete,
  onCompleteSubtask,
  onPush,
  busy = false,
}: {
  task: Task
  onComplete: (task: Task) => void
  onCompleteSubtask: (task: Task, subtask: Subtask) => void
  /** Move it out of today. Recovery is a feature, not a failure path. */
  onPush: (task: Task) => void
  busy?: boolean
}) {
  const estimate = formatEstimate(estimateOf(task))
  const nextStep = task.subtasks.find((subtask) => !subtask.done)
  const doneCount = task.subtasks.filter((subtask) => subtask.done).length

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3.5">
        <DomainIcon domain={task.domain} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {nextStep ? (
            <span className="truncate text-body-sm text-ink-muted">{task.title}</span>
          ) : null}

          <h2 className="text-heading-sm text-balance text-ink">
            {nextStep ? nextStep.text : task.title}
          </h2>

          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <TimeUntil dueAt={task.dueAt} className="text-body-sm font-bold tabular text-accent" />
            {estimate ? (
              <Pill tone="field" icon={<Clock size={13} />} className="px-2 py-0 text-micro">
                {estimate}
              </Pill>
            ) : null}
            {task.subtasks.length > 0 ? (
              <span className="text-body-sm tabular text-ink-subtle">
                {doneCount}/{task.subtasks.length}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <DeadlineMeter dueAt={task.dueAt} />

      <div className="flex items-center gap-2.5">
        <Button
          variant="solid"
          className="flex-1"
          disabled={busy}
          onClick={() => (nextStep ? onCompleteSubtask(task, nextStep) : onComplete(task))}
        >
          <Check />
          Done
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onPush(task)}>
          Not today
        </Button>
      </div>
    </section>
  )
}
