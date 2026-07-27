import { cn } from '@/lib/cn'

// The workhorse list row: identity chip, title, one line of quiet meta, and a
// trailing affordance. Everything in the app that is "a thing with a state"
// renders through this shape, so the lists read as one system.
export function TaskRow({
  leading,
  title,
  meta,
  trailing,
  muted = false,
  className,
}: {
  leading: React.ReactNode
  title: React.ReactNode
  meta?: React.ReactNode
  trailing?: React.ReactNode
  /** Resolved / done — the row steps back without disappearing. */
  muted?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card',
        className,
      )}
    >
      {leading}
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-heading-sm text-ink',
            muted && 'text-ink-muted line-through decoration-ink-subtle',
          )}
        >
          {title}
        </span>
        {meta ? (
          <span className="truncate text-body-sm text-ink-muted">{meta}</span>
        ) : null}
      </div>
      {trailing}
    </div>
  )
}
