'use client'

import { Button } from '@/components/ui/button'
import { RANGE_PRESETS, toLocalInputValue, fromLocalInputValue } from '@/lib/taskFormat'
import {
  DOMAIN_LABEL,
  TASK_DOMAINS,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  useTaskTags,
  type TaskFilters,
} from '@/queries/tasks'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'

// Every filter the list supports, in one sheet.
//
// Presets sit ABOVE the custom range: "This week" is what people actually mean
// nine times out of ten, and making them assemble it from two date inputs is
// the friction that stops filters being used at all.

const STATUS_LABEL: Record<(typeof TASK_STATUSES)[number], string> = {
  open: 'Open',
  done: 'Done',
  snoozed: 'Snoozed',
}

const KIND_LABEL: Record<(typeof TASK_KINDS)[number], string> = {
  reminder: 'Reminders',
  list: 'List items',
}

const PRIORITY_LABEL: Record<(typeof TASK_PRIORITIES)[number], string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

// Toggle one member of an array filter. Returns undefined when the last member
// is removed, so the key drops out of the querystring entirely rather than
// being sent as an empty value the strict schema would reject.
function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
  const next = list?.includes(value)
    ? list.filter((v) => v !== value)
    : [...(list ?? []), value]
  return next.length > 0 ? next : undefined
}

export function FilterSheet({
  open,
  onClose,
  trigger,
  filters,
  onChange,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  filters: TaskFilters
  onChange: (next: TaskFilters) => void
}) {
  const tags = useTaskTags()
  const patch = (p: Partial<TaskFilters>) => onChange({ ...filters, ...p })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={560}
      eyebrow="Narrow the list"
      title="Filter"
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            Clear all
          </button>
          <Button className="h-8 px-4 text-caption" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <SheetSection label="Quick">
        <div className="flex flex-wrap gap-1.5">
          <ChipToggle
            selected={filters.overdue === true}
            onClick={() => patch({ overdue: filters.overdue ? undefined : true })}
          >
            Overdue
          </ChipToggle>
          <ChipToggle
            selected={filters.undated === true}
            onClick={() => patch({ undated: filters.undated ? undefined : true })}
          >
            No date
          </ChipToggle>
          <ChipToggle
            selected={filters.untagged === true}
            onClick={() => patch({ untagged: filters.untagged ? undefined : true })}
          >
            Untagged
          </ChipToggle>
        </div>
      </SheetSection>

      <SheetSection label="Status">
        <div className="flex flex-wrap gap-1.5">
          {TASK_STATUSES.map((s) => (
            <ChipToggle
              key={s}
              selected={filters.status?.includes(s) ?? false}
              onClick={() => patch({ status: toggle(filters.status, s) })}
            >
              {STATUS_LABEL[s]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Domain">
        <div className="flex flex-wrap gap-1.5">
          {TASK_DOMAINS.map((d) => (
            <ChipToggle
              key={d}
              selected={filters.domain?.includes(d) ?? false}
              onClick={() => patch({ domain: toggle(filters.domain, d) })}
            >
              {DOMAIN_LABEL[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Priority">
        <div className="flex flex-wrap gap-1.5">
          {TASK_PRIORITIES.map((p) => (
            <ChipToggle
              key={p}
              selected={filters.priority?.includes(p) ?? false}
              onClick={() => patch({ priority: toggle(filters.priority, p) })}
            >
              {PRIORITY_LABEL[p]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label="Type">
        <div className="flex flex-wrap gap-1.5">
          {TASK_KINDS.map((k) => (
            <ChipToggle
              key={k}
              selected={filters.kind?.includes(k) ?? false}
              onClick={() => patch({ kind: toggle(filters.kind, k) })}
            >
              {KIND_LABEL[k]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      {(tags.data?.length ?? 0) > 0 ? (
        <SheetSection label="Tags">
          <div className="flex flex-wrap gap-1.5">
            {tags.data?.map((tag) => (
              <ChipToggle
                key={tag}
                selected={filters.tag?.includes(tag) ?? false}
                onClick={() => patch({ tag: toggle(filters.tag, tag) })}
              >
                #{tag}
              </ChipToggle>
            ))}
          </div>
        </SheetSection>
      ) : null}

      <SheetSection label="Due range">
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset) => {
            const range = preset.range(new Date())
            const active =
              filters.dueAfter === range.dueAfter && filters.dueBefore === range.dueBefore
            return (
              <ChipToggle
                key={preset.label}
                selected={active}
                onClick={() =>
                  patch(
                    active
                      ? { dueAfter: undefined, dueBefore: undefined }
                      : { dueAfter: range.dueAfter, dueBefore: range.dueBefore },
                  )
                }
              >
                {preset.label}
              </ChipToggle>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            aria-label="Due from"
            value={toLocalInputValue(filters.dueAfter)}
            onChange={(e) => patch({ dueAfter: fromLocalInputValue(e.target.value) })}
            className="h-9 min-w-0 flex-1 rounded-md bg-surface-sunken px-2 text-caption text-ink outline-none"
          />
          <span className="text-caption text-ink-subtle">to</span>
          <input
            type="datetime-local"
            aria-label="Due to"
            value={toLocalInputValue(filters.dueBefore)}
            onChange={(e) => patch({ dueBefore: fromLocalInputValue(e.target.value) })}
            className="h-9 min-w-0 flex-1 rounded-md bg-surface-sunken px-2 text-caption text-ink outline-none"
          />
        </div>
      </SheetSection>
    </Sheet>
  )
}
