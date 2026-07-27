'use client'

import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'
import { SORT_LABEL, TASK_SORTS, type TaskSort } from '@/queries/tasks'
import { Sheet, SheetSection } from '@/components/ui/Sheet'

export const GROUP_MODES = ['time', 'domain', 'priority', 'flat'] as const
export type GroupMode = (typeof GROUP_MODES)[number]

const GROUP_LABEL: Record<GroupMode, string> = {
  time: 'By when',
  domain: 'By domain',
  priority: 'By priority',
  flat: 'No grouping',
}

// Sort and grouping in one sheet, because they answer the same question —
// "how do I want to look at this?" — and splitting them into two controls
// doubles the taps for a single mental act.
//
// Grouping is a LENS. It reorders what's on screen and never writes anything;
// no matter is ever moved out from under the user by choosing a view.
export function SortSheet({
  open,
  onClose,
  trigger,
  sort,
  onSortChange,
  group,
  onGroupChange,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  sort: TaskSort
  onSortChange: (s: TaskSort) => void
  group: GroupMode
  onGroupChange: (g: GroupMode) => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={520}
      eyebrow="How you see it"
      title="Arrange"
    >
      <SheetSection label="Group">
        <ul className="overflow-hidden rounded-lg border border-border">
          {GROUP_MODES.map((mode) => (
            <li key={mode}>
              <Row
                label={GROUP_LABEL[mode]}
                selected={group === mode}
                onClick={() => onGroupChange(mode)}
              />
            </li>
          ))}
        </ul>
      </SheetSection>

      <SheetSection label="Sort within groups">
        <ul className="overflow-hidden rounded-lg border border-border">
          {TASK_SORTS.map((s) => (
            <li key={s}>
              <Row label={SORT_LABEL[s]} selected={sort === s} onClick={() => onSortChange(s)} />
            </li>
          ))}
        </ul>
      </SheetSection>
    </Sheet>
  )
}

function Row({
  label,
  selected,
  onClick,
}: {
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left text-body-sm last:border-b-0 transition-colors',
        selected ? 'bg-accent-soft text-ink' : 'bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {label}
      {selected ? <Check size={16} className="text-accent" /> : null}
    </button>
  )
}
