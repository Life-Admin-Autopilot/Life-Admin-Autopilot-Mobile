'use client'

import { useTranslations } from 'next-intl'

import { useDomainLabels } from '@/hooks/useDomainLabels'

import { Button } from '@/components/ui/button'
import { RANGE_PRESETS, toLocalInputValue, fromLocalInputValue } from '@/lib/taskFormat'
import {
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

// Status, kind and priority labels are all keyed by the value itself
// (`matters.status.*`, `matters.kind.*`, `matters.priority.*`), so the chips map
// straight off the TASK_* tuples. The priority set in particular is shared with
// the editor and the list row rather than restated here.

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
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  const domainLabels = useDomainLabels()
  const tags = useTaskTags()
  const patch = (p: Partial<TaskFilters>) => onChange({ ...filters, ...p })

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={560}
      eyebrow={t('filter.eyebrow')}
      title={t('controls.filter')}
      footer={
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-pill px-3 py-1.5 text-caption text-ink-subtle hover:bg-surface-sunken hover:text-ink"
          >
            {t('filter.clearAll')}
          </button>
          <Button className="h-8 px-4 text-caption" onClick={onClose}>
            {tCommon('done')}
          </Button>
        </div>
      }
    >
      <SheetSection label={t('section.quick')}>
        <div className="flex flex-wrap gap-1.5">
          <ChipToggle
            selected={filters.overdue === true}
            onClick={() => patch({ overdue: filters.overdue ? undefined : true })}
          >
            {t('bucket.overdue')}
          </ChipToggle>
          <ChipToggle
            selected={filters.undated === true}
            onClick={() => patch({ undated: filters.undated ? undefined : true })}
          >
            {t('due.noDate')}
          </ChipToggle>
          <ChipToggle
            selected={filters.untagged === true}
            onClick={() => patch({ untagged: filters.untagged ? undefined : true })}
          >
            {t('filter.untagged')}
          </ChipToggle>
        </div>
      </SheetSection>

      <SheetSection label={t('section.status')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_STATUSES.map((s) => (
            <ChipToggle
              key={s}
              selected={filters.status?.includes(s) ?? false}
              onClick={() => patch({ status: toggle(filters.status, s) })}
            >
              {t(`status.${s}`)}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={t('section.domain')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_DOMAINS.map((d) => (
            <ChipToggle
              key={d}
              selected={filters.domain?.includes(d) ?? false}
              onClick={() => patch({ domain: toggle(filters.domain, d) })}
            >
              {domainLabels[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={t('section.priority')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_PRIORITIES.map((p) => (
            <ChipToggle
              key={p}
              selected={filters.priority?.includes(p) ?? false}
              onClick={() => patch({ priority: toggle(filters.priority, p) })}
            >
              {t(`priority.${p}`)}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <SheetSection label={t('section.type')}>
        <div className="flex flex-wrap gap-1.5">
          {TASK_KINDS.map((k) => (
            <ChipToggle
              key={k}
              selected={filters.kind?.includes(k) ?? false}
              onClick={() => patch({ kind: toggle(filters.kind, k) })}
            >
              {t(`kind.${k}`)}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      {(tags.data?.length ?? 0) > 0 ? (
        <SheetSection label={t('section.tags')}>
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

      <SheetSection label={t('section.dueRange')}>
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset) => {
            const range = preset.range(new Date())
            const active =
              filters.dueAfter === range.dueAfter && filters.dueBefore === range.dueBefore
            return (
              <ChipToggle
                key={preset.labelKey}
                selected={active}
                onClick={() =>
                  patch(
                    active
                      ? { dueAfter: undefined, dueBefore: undefined }
                      : { dueAfter: range.dueAfter, dueBefore: range.dueBefore },
                  )
                }
              >
                {t(`range.preset.${preset.labelKey}`)}
              </ChipToggle>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="datetime-local"
            aria-label={t('filter.dueFrom')}
            value={toLocalInputValue(filters.dueAfter)}
            onChange={(e) => patch({ dueAfter: fromLocalInputValue(e.target.value) })}
            className="h-9 min-w-0 flex-1 rounded-md bg-surface-sunken px-2 text-caption text-ink outline-none"
          />
          <span className="text-caption text-ink-subtle">{t('filter.to')}</span>
          <input
            type="datetime-local"
            aria-label={t('filter.dueTo')}
            value={toLocalInputValue(filters.dueBefore)}
            onChange={(e) => patch({ dueBefore: fromLocalInputValue(e.target.value) })}
            className="h-9 min-w-0 flex-1 rounded-md bg-surface-sunken px-2 text-caption text-ink outline-none"
          />
        </div>
      </SheetSection>
    </Sheet>
  )
}
