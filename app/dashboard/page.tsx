'use client'

import Link from 'next/link'

import { AppHeader } from '@/components/layout/AppHeader'
import { HomeHero } from '@/components/dashboard/HomeHero'
import { MatterRow } from '@/components/dashboard/MatterRow'
import { UncertaintyBanner } from '@/components/uncertainty/UncertaintyBanner'
import { useSessionStore, selectUser } from '@/lib/auth/sessionStore'
import { bucketOf, formatDue } from '@/lib/taskFormat'
import { useTaskCounts, useTasks } from '@/queries/tasks'

function firstName(displayName?: string, email?: string): string {
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0]
  if (email) return email.split('@')[0]
  return 'there'
}

// The home/dashboard — greets the onboarded user by name, then shows only what
// is live right now. The full workspace is /matters; this is the glance.
//
// Deliberately capped at three rows. The point of this screen is reassurance,
// and a home screen that grows without bound stops being reassuring.
const PREVIEW_ROWS = 3

export default function DashboardPage() {
  const user = useSessionStore(selectUser)
  const name = firstName(user?.displayName, user?.email)

  const counts = useTaskCounts()
  // Soonest-first open matters; the hero's numbers come from the counts
  // endpoint so they agree with /matters exactly.
  const list = useTasks({ status: ['open'] }, 'due-asc')
  const upcoming = (list.data?.pages[0]?.tasks ?? []).slice(0, PREVIEW_ROWS)

  const attention = (counts.data?.overdue ?? 0) + (counts.data?.today ?? 0)

  return (
    <main className="min-h-dvh pb-28">
      <AppHeader />
      <HomeHero
        name={name}
        now={new Date()}
        attention={attention}
        stats={{
          all: counts.data?.open ?? 0,
          due: (counts.data?.today ?? 0) + (counts.data?.tomorrow ?? 0),
          resolved: counts.data?.done ?? 0,
        }}
      />

      <div className="mx-auto mt-6 max-w-md px-6">
        <UncertaintyBanner />
      </div>

      {upcoming.length > 0 ? (
        <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 px-6">
          <div className="flex items-baseline justify-between">
            <span className="text-label uppercase text-accent">Coming up</span>
            <Link href="/matters" className="text-caption text-ink-subtle hover:text-ink">
              View all
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
            {upcoming.map((task, i) => (
              <div key={task.id}>
                {i > 0 ? <div className="mx-4 h-px bg-border" /> : null}
                <Link href="/matters" className="block">
                  <MatterRow
                    domain={task.domain}
                    title={task.title}
                    due={formatDue(task.dueAt)}
                    overdue={bucketOf(task) === 'overdue'}
                  />
                </Link>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </main>
  )
}
