'use client'

import { AppHeader } from '@/components/layout/AppHeader'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { useSessionStore, selectUser } from '@/lib/auth/sessionStore'
import { toast } from '@/lib/toast'
import { useDigest } from '@/queries/digest'
import {
  useCompleteTask,
  useSnoozeTask,
  useTaskCounts,
  useTasks,
  useToggleSubtask,
  useUpdateTask,
  type Task,
} from '@/queries/tasks'

function firstName(displayName?: string, email?: string): string {
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0]
  if (email) return email.split('@')[0]
  return 'there'
}

/** Tomorrow morning, local. Where "not today" sends things. */
function tomorrowMorning(now: Date): string {
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(9, 0, 0, 0)
  return next.toISOString()
}

// Data container only. The layout lives in DashboardView so the preview route
// can render the identical tree against fixtures — see /zz-preview-dashboard.
//
// TWO reads, split by cost, not by topic. `counts` is pure aggregation and
// returns in milliseconds; `digest` writes a sentence with a language model and
// does not. Every FIGURE on the screen comes from the fast one so the page can
// resolve without the slow one — the digest now contributes only its headline.
//
// It used to be one read for both, and the dashboard inherited the slower half:
// "Needs you" arrived visibly after the matters beside it, and it arrived latest
// exactly when the user had just changed something, because a changed
// fingerprint is precisely what misses the digest's cache.
export default function DashboardPage() {
  const user = useSessionStore(selectUser)
  const name = firstName(user?.displayName, user?.email)

  const list = useTasks({ status: ['open'] }, 'due-asc')
  const counts = useTaskCounts()
  const digest = useDigest()

  const completeTask = useCompleteTask()
  const snoozeTask = useSnoozeTask()
  const toggleSubtask = useToggleSubtask()
  const updateTask = useUpdateTask()

  const now = new Date()

  // "Not today" snoozes; it does not delete, and it does not touch the real
  // deadline — rewriting dueAt would be a lie about when a bill is actually
  // due. But an item that silently vanishes is indistinguishable from one the
  // app threw away, so the move always announces itself and always offers a
  // way back. Recovery is the whole point of the affordance.
  const pushToTomorrow = (task: Task) => {
    const previousStatus = task.status
    snoozeTask.mutate(
      { taskId: task.id, until: tomorrowMorning(now) },
      {
        onSuccess: () =>
          toast.success('Moved to tomorrow.', {
            description: 'Its due date has not changed.',
            action: {
              label: 'Undo',
              onPress: () =>
                updateTask.mutate({
                  taskId: task.id,
                  body: { status: previousStatus, snoozedUntil: null },
                }),
            },
          }),
        onError: () => toast.error('That did not go through. Try again.'),
      },
    )
  }

  // The scan count was derived client-side from the full documents list, which
  // meant loading every scan to learn one number. It is a server count now —
  // computeTaskCounts applies the same `ready_for_review AND no reviewedAt`
  // rule, which is the real "needs you" signal (the status alone is terminal
  // and is kept forever, reviewed or not).
  return (
    <main className="min-h-dvh pb-32">
      <AppHeader />
      <DashboardView
        name={name}
        now={now}
        openTasks={list.data?.pages[0]?.tasks ?? []}
        loaded={!list.isPending}
        completedToday={counts.data?.completedToday ?? 0}
        needsInput={counts.data?.needsInput ?? 0}
        scansAwaitingReview={counts.data?.scansAwaitingReview ?? 0}
        slipping={counts.data?.slipping ?? 0}
        // Until the counts land, zero is UNKNOWN, not "nothing needs you" —
        // the strip renders placeholders rather than asserting an all-clear it
        // cannot yet support, and reserves its space so nothing jumps.
        countsLoaded={!counts.isPending}
        digest={digest.data}
        busy={completeTask.isPending || snoozeTask.isPending || toggleSubtask.isPending}
        onComplete={(task) => completeTask.mutate({ taskId: task.id, done: true })}
        onCompleteSubtask={(task, subtask) =>
          toggleSubtask.mutate({ taskId: task.id, subtaskId: subtask.id, done: true })
        }
        onPush={pushToTomorrow}
      />
    </main>
  )
}
