'use client'

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@/lib/cn'
import { TASK_SORTS, type TaskSort } from '@/queries/tasks'
import { Sheet, SheetSection } from '@/components/ui/Sheet'

// Both label sets are keyed by the value they describe — `matters.group.<mode>`
// and `matters.sortBy.<sort>` — so neither needs a module-level Record that
// could not call a hook anyway.
export const GROUP_MODES = ['time', 'domain', 'priority', 'flat'] as const
export type GroupMode = (typeof GROUP_MODES)[number]

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
  const t = useTranslations('matters')

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={520}
      eyebrow={t('sort.eyebrow')}
      title={t('controls.arrange')}
    >
      <SheetSection label={t('section.group')}>
        <ul className="overflow-hidden rounded-lg border border-border">
          {GROUP_MODES.map((mode) => (
            <li key={mode}>
              <Row
                label={t(`group.${mode}`)}
                selected={group === mode}
                onClick={() => onGroupChange(mode)}
              />
            </li>
          ))}
        </ul>
      </SheetSection>

      <SheetSection label={t('section.sortWithin')}>
        <ul className="overflow-hidden rounded-lg border border-border">
          {TASK_SORTS.map((s) => (
            <li key={s}>
              <Row
                label={t(`sortBy.${s}`)}
                selected={sort === s}
                onClick={() => onSortChange(s)}
              />
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
        'flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-start text-body-sm last:border-b-0 transition-colors',
        selected ? 'bg-accent-soft text-ink' : 'bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {label}
      {selected ? <Check size={16} className="text-accent" /> : null}
    </button>
  )
}
