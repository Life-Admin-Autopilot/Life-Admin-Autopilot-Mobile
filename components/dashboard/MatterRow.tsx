import { ChevronRight } from 'lucide-react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'

// A single matter row — DomainIcon chip · title · due (crimson) · trailing
// state. Shared by the dashboard list and the styleguide pattern.
export function MatterRow({
  domain,
  title,
  due,
  overdue,
  icon,
}: {
  domain: Domain
  title: string
  due: string
  overdue?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <DomainIcon domain={domain} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-heading-sm text-ink">{title}</span>
        <span className="text-caption tabular text-accent">{due}</span>
      </div>
      {overdue ? (
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-micro uppercase text-accent">
          Overdue
        </span>
      ) : (
        (icon ?? <ChevronRight size={18} className="text-ink-subtle" />)
      )}
    </div>
  )
}
