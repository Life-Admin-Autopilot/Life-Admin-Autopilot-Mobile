'use client'

import { AlertTriangle } from 'lucide-react'

import { useTaskConflicts } from '@/queries/planning'

/**
 * Conflicts for a saved matter, re-checked by the Knowledge Agent.
 *
 * This is the "Task Edited Later" arrow made visible: `useUpdateTask`
 * invalidates this query on every patch, so moving a matter onto another one
 * surfaces the clash immediately, in the same sheet the edit was made in —
 * rather than the user discovering it on the day.
 *
 * Renders nothing when there is no clash. A permanent "no conflicts" banner
 * would be reassurance the user did not ask for, taking space from the fields
 * they opened this sheet to change.
 */
export function ConflictNotice({ taskId }: { taskId: string }) {
  const { data } = useTaskConflicts(taskId)
  const conflicts = data?.conflicts ?? []

  if (conflicts.length === 0) return null

  return (
    <div className="mb-3 rounded-2xl bg-warning/10 p-3">
      <div className="flex items-center gap-1.5">
        <AlertTriangle size={14} className="shrink-0 text-warning" />
        <p className="text-label uppercase tracking-wide text-warning">
          {conflicts.length === 1 ? 'Scheduling clash' : `${conflicts.length} clashes`}
        </p>
      </div>
      <ul className="mt-1.5 flex flex-col gap-1">
        {conflicts.map((conflict) => (
          <li key={conflict.taskId} className="text-body-sm text-ink" dir="auto">
            {conflict.reason} <span className="text-ink-muted">“{conflict.title}”</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
