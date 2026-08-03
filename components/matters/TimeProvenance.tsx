'use client'

import { CalendarClock, TriangleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { env } from '@/lib/env'
import type { Task } from '@/queries/tasks'

// Where an imported matter's TIME came from.
//
// This exists because of the trust contract in principles.md: a value the user
// reads as "the calendar said 9am" must not silently be "we picked 9am". Two
// imported cases are not source-derived at all, and both have to say so:
//
//   dateOnly — the source gave a date and no time. Google Tasks cannot express
//              one; all-day calendar events do not have one. The time shown is
//              the user's own default.
//
//   floating — the source gave a wall clock with no timezone (RFC 5545 calls
//              this floating). We assumed the user's zone, which for a London
//              school feed read in Dubai is four hours wrong. So the matter is
//              filed WITHOUT a nudge until the user confirms it — and this
//              banner is the only thing that explains why it is sitting quiet.
//
// Renders nothing when the time is genuinely the source's, or when the matter
// did not come from an integration at all. Silence is the correct output for a
// value with nothing to disclose.

export function TimeProvenance({ task }: { task: Task }) {
  const t = useTranslations('matters')

  if (!task.externalSource) return null
  if (!task.timePrecision || task.timePrecision === 'exact') return null

  const floating = task.timePrecision === 'floating'
  const Icon = floating ? TriangleAlert : CalendarClock

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-2xl px-3 py-2.5',
        floating ? 'bg-warning-soft' : 'bg-surface-sunken',
      )}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        className={cn('mt-0.5 shrink-0', floating ? 'text-warning' : 'text-ink-subtle')}
      />
      <p className={cn('text-caption', floating ? 'text-warning' : 'text-ink-subtle')}>
        {floating ? t('provenance.floating', { app: env.appName }) : t('provenance.dateOnly')}
      </p>
    </div>
  )
}
