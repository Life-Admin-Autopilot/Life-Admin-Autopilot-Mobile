import { cn } from '@/lib/cn'

// The pill family. One shape, several jobs — the tone is what distinguishes
// "this is a value you set" from "this is how urgent it is".
export type PillTone =
  | 'accent' // tag / badge — coral on a coral wash
  | 'field' // a value the user chose (a time, a domain)
  | 'surface' // a suggestion or quick action, floating on the canvas
  | 'high'
  | 'medium'
  | 'low'
  | 'success'
  // A caveat on a value that is otherwise correct — the date that is filed but
  // will never ring. Distinct from `danger`, which is reserved for destructive
  // confirmations and would read as "something broke".
  | 'warning'
  | 'danger'

const TONE: Record<PillTone, string> = {
  accent: 'bg-accent-soft text-accent',
  field: 'bg-surface-field text-ink',
  surface: 'bg-surface text-ink shadow-card',
  high: 'bg-priority-high-soft text-priority-high',
  medium: 'bg-priority-med-soft text-priority-med',
  low: 'bg-priority-low-soft text-priority-low',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

export function Pill({
  children,
  tone = 'field',
  icon,
  uppercase = false,
  className,
}: {
  children: React.ReactNode
  tone?: PillTone
  icon?: React.ReactNode
  uppercase?: boolean
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-3 py-1',
        uppercase ? 'text-label uppercase' : 'text-body-sm font-bold',
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
