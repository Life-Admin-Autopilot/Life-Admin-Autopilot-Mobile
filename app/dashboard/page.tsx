'use client'

import Link from 'next/link'

import { AppHeader } from '@/components/layout/AppHeader'
import { HomeHero } from '@/components/dashboard/HomeHero'
import { MatterRow } from '@/components/dashboard/MatterRow'
import { SectionHeaderChip } from '@/components/ui/SectionHeaderChip'
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
    <main className="min-h-dvh pb-32">
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

      <div className="mx-auto mt-6 max-w-md px-5">
        <UncertaintyBanner />
      </div>

      {upcoming.length > 0 ? (
        <div className="mx-auto mt-7 flex max-w-md flex-col gap-3 px-5">
          <div className="flex items-center justify-between">
            <SectionHeaderChip label="Coming up" tone="morning" count={upcoming.length} />
            <Link
              href="/matters"
              className="rounded-pill px-2 py-1 text-body-sm font-bold text-accent hover:bg-accent-soft"
            >
              View all
            </Link>
          </div>
          {upcoming.map((task) => (
            <Link key={task.id} href="/matters" className="block">
              <MatterRow
                domain={task.domain}
                title={task.title}
                due={formatDue(task.dueAt)}
                overdue={bucketOf(task) === 'overdue'}
              />
            </Link>
          ))}
        </div>
      ) : null}
    </main>
  )
}
