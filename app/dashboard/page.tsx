'use client'

import { AppHeader } from '@/components/layout/AppHeader'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { useSessionStore, selectUser } from '@/lib/auth/sessionStore'
import { toast } from '@/lib/toast'
import { useDigest } from '@/queries/digest'
import { useScannedDocuments } from '@/queries/documentScans'
import {
  useCompleteTask,
  useSnoozeTask,
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
export default function DashboardPage() {
  const user = useSessionStore(selectUser)
  const name = firstName(user?.displayName, user?.email)

  const list = useTasks({ status: ['open'] }, 'due-asc')
  const scans = useScannedDocuments()
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

  // `ready_for_review` is the TERMINAL SUCCESS state of processing, not a
  // to-do: every document that scanned cleanly keeps it forever, confirmed or
  // not. `reviewedAt` is what the server stamps once every candidate has been
  // resolved (me.documentScans.ts), so its absence is the real "needs you".
  const scansAwaitingReview =
    scans.data?.scannedDocuments.filter(
      (doc) => doc.status === 'ready_for_review' && !doc.reviewedAt,
    ).length ?? 0

  return (
    <main className="min-h-dvh pb-32">
      <AppHeader />
      <DashboardView
        name={name}
        now={now}
        openTasks={list.data?.pages[0]?.tasks ?? []}
        loaded={!list.isPending}
        completedToday={digest.data?.counts.completedToday ?? 0}
        needsInput={digest.data?.counts.needsInput ?? 0}
        scansAwaitingReview={scansAwaitingReview}
        slipping={digest.data?.counts.slipping ?? 0}
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
