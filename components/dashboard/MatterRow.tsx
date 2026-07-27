import { ChevronRight } from 'lucide-react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { Pill } from '@/components/ui/Pill'
import { TaskRow } from '@/components/ui/TaskRow'

// A single matter row — emoji chip · title · due · trailing state. Shared by
// the dashboard list and the styleguide pattern.
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
    <TaskRow
      leading={<DomainIcon domain={domain} />}
      title={title}
      meta={<span className="tabular">{due}</span>}
      trailing={
        overdue ? (
          <Pill tone="high" uppercase>
            Overdue
          </Pill>
        ) : (
          (icon ?? <ChevronRight size={18} className="shrink-0 text-ink-subtle" />)
        )
      }
    />
  )
}
