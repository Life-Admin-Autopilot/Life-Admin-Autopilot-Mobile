'use client'

import { ChevronRight } from 'lucide-react'

import { EmojiChip, type CatColor } from '@/components/ui/EmojiChip'
import { SwitchVisual } from '@/components/ui/CompletionRing'
import { cn } from '@/lib/cn'

// The settings list row, in two shapes: one that opens a sheet, and one that is
// itself a switch. Same silhouette as TaskRow so a settings list reads as the
// same system as a matters list — identity chip, label, trailing affordance.

const ROW = 'flex w-full items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card'

interface RowIdentity {
  emoji: string
  category?: CatColor
  title: string
}

export function SettingRow({
  emoji,
  category = 'lilac',
  title,
  value,
  /**
   * Receives the row's own bounding box. Every sheet in this app grows out of
   * the control that opened it, and passing the rect is how — so the row
   * captures it rather than trusting each caller to remember
   * `e.currentTarget.getBoundingClientRect()`.
   */
  onOpen,
  tone = 'default',
  disabled = false,
  className,
}: RowIdentity & {
  value?: React.ReactNode
  onOpen: (rect: DOMRect) => void
  /** `danger` for irreversible destinations — deleting the account. */
  tone?: 'default' | 'danger'
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
      className={cn(
        ROW,
        'text-start transition-transform active:scale-[0.99] disabled:opacity-50',
        className,
      )}
    >
      <EmojiChip emoji={emoji} category={category} size={40} />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-heading-sm',
          tone === 'danger' ? 'text-danger' : 'text-ink',
        )}
      >
        {title}
      </span>
      {value ? (
        // Capped so a long email truncates instead of squeezing the label into
        // a two-character column.
        <span className="max-w-[45%] truncate text-body-sm text-ink-muted">{value}</span>
      ) : null}
      <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-subtle" />
    </button>
  )
}

export function SettingToggleRow({
  emoji,
  category = 'lilac',
  title,
  meta,
  checked,
  onChange,
  disabled = false,
  className,
}: RowIdentity & {
  /** One quiet line under the title — what the switch actually does. */
  meta?: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(ROW, 'text-start disabled:opacity-50', className)}
    >
      <EmojiChip emoji={emoji} category={category} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-heading-sm text-ink">{title}</span>
        {meta ? <span className="truncate text-body-sm text-ink-muted">{meta}</span> : null}
      </span>
      <SwitchVisual checked={checked} />
    </button>
  )
}

/**
 * A row that DOES something rather than opening something. No chevron — the
 * chevron is a promise of another screen, and breaking that promise is how a
 * list stops being readable at a glance.
 */
export function SettingActionRow({
  emoji,
  category = 'lilac',
  title,
  meta,
  pending = false,
  pendingTitle,
  onAction,
  disabled = false,
  className,
}: RowIdentity & {
  meta?: string
  pending?: boolean
  /** Replaces the title while the action runs, e.g. "Preparing…". */
  pendingTitle?: string
  onAction: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={onAction}
      className={cn(
        ROW,
        'text-start transition-transform active:scale-[0.99] disabled:opacity-50',
        className,
      )}
    >
      <EmojiChip emoji={emoji} category={category} size={40} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-heading-sm text-ink">
          {pending ? (pendingTitle ?? 'Working…') : title}
        </span>
        {meta ? <span className="truncate text-body-sm text-ink-muted">{meta}</span> : null}
      </span>
    </button>
  )
}

/** Label + rows. The label is the only heading a settings group needs. */
export function SettingGroup({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <h2 className="text-label uppercase text-ink-muted">{label}</h2>
      <div className="flex flex-col gap-2.5">{children}</div>
    </section>
  )
}
