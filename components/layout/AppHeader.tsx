import { Menu } from 'lucide-react'

import { NotificationBell } from '@/components/notifications/NotificationBell'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { env } from '@/lib/env'

// App chrome: circular pucks flanking a serif title. Every screen wears this —
// the page's own controls go in a row underneath it, never in place of it.
//
// The title is absolutely centred rather than laid out between the two puck
// clusters. There are two pucks on the right and one on the left, so a plain
// `justify-between` centres the title in the LEFTOVER space — which puts it
// visibly off-centre on the screen. Absolute centring makes it agree with the
// device's midline no matter how many controls each side grows.
//
// The centred layer spans `top-safe` → `bottom-1`: exactly the header's content
// box, so `items-center` puts the title on the same optical line as the pucks.
// `inset-0` would stretch it over the notch inset too and hang the title low.
export function AppHeader({ title }: { title?: string }) {
  // A header that names the screen IS that screen's heading. The wordmark
  // variant is not — there the page's own hero owns the h1.
  const Title = title ? 'h1' : 'span'

  return (
    <header className="pt-safe relative flex items-center justify-between gap-2 px-5 pb-1">
      <button
        type="button"
        aria-label="Menu"
        className="relative z-10 grid size-11 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <Menu size={20} strokeWidth={1.75} />
      </button>

      {/* pointer-events-none so the title never swallows a tap meant for a
          puck it happens to overlap on a narrow screen. */}
      <Title className="top-safe pointer-events-none absolute inset-x-0 bottom-1 flex items-center justify-center">
        <span className="max-w-[55%] truncate font-display text-heading-serif text-ink">
          {title ?? env.appName}
        </span>
      </Title>

      <div className="relative z-10 flex shrink-0 items-center">
        <ThemeToggle />
        <NotificationBell />
      </div>
    </header>
  )
}
