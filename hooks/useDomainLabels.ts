'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { TASK_DOMAINS, type TaskDomain } from '@/queries/tasks'

/**
 * The six life-admin domains, labelled in the active language.
 *
 * Replaces three parallel hardcoded maps that had drifted apart — one in
 * queries/tasks.ts, one in components/scan/candidateDisplay.tsx, one in
 * CalendarFeedsSheet — so a domain is now named in exactly one place per
 * language.
 *
 * Returns a Record rather than exposing `t` so it can be handed straight to
 * `groupByDomain(tasks, labels)`, which needs the whole map at once.
 */
export function useDomainLabels(): Record<TaskDomain, string> {
  const t = useTranslations('domain')

  return useMemo(
    () =>
      TASK_DOMAINS.reduce(
        (acc, domain) => {
          acc[domain] = t(domain)
          return acc
        },
        {} as Record<TaskDomain, string>,
      ),
    [t],
  )
}
