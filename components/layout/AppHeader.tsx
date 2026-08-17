import { HeaderBackButton } from '@/components/layout/HeaderBackButton'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { env } from '@/lib/env'

// App chrome: circular pucks beside a serif title. Every screen wears this —
// the page's own controls go in a row underneath it, never in place of it.
//
// The title is absolutely centred rather than laid out against the puck
// cluster. Flowing it would centre it in the LEFTOVER space, which puts it
// visibly off-centre on the screen. Absolute centring makes it agree with the
// device's midline no matter how many controls the cluster grows.
//
// There used to be a hamburger puck on the left. It had no handler and opened
// nothing; Profile — its only plausible destination — is now a real tab, so it
// was removed rather than left as a control that does nothing on every screen.
// The left slot is used again now, but only by screens that were opened FROM a
// tab and therefore have somewhere specific to go back to (`backTo`) — a tabbed
// screen has no "back", and a puck that reads as one would be that same dead
// control returning.
//
// The centred layer spans `top-safe` → `bottom-1`: exactly the header's content
// box, so `items-center` puts the title on the same optical line as the pucks.
// `inset-0` would stretch it over the notch inset too and hang the title low.
//
// `z-30` on the header is load-bearing, not decoration. The puck clusters carry
// `z-10` to paint over the absolutely-centred title, and that makes each cluster
// its own stacking context — so the notification dropdown's own z-index is
// sealed inside it and can never rise past 10 in the page's terms. Screens that
// put a `sticky top-0 z-20` control row under this header (/documents,
// /matters) would then draw that row straight over the open panel. Lifting the
// whole header above those rows fixes it for every screen at once. The header
// never overlaps a stuck row — the row only sticks once the header has scrolled
// fully out — so nothing else changes.
export function AppHeader({
  title,
  /**
   * Route to land on when this screen was opened cold (a deep link, a
   * notification tap) and there is no history to go back through. Presence of
   * this prop is what puts the back puck in the leading slot.
   */
  backTo,
}: {
  title?: string
  backTo?: string
}) {
  // A header that names the screen IS that screen's heading. The wordmark
  // variant is not — there the page's own hero owns the h1.
  const Title = title ? 'h1' : 'span'

  return (
    // Still `justify-end`: the control cluster holds the trailing edge whether
    // or not a back puck exists. The puck carries its own `me-auto` to claim the
    // leading edge, which is why this stays one static class rather than
    // switching to `justify-between` — with no puck, `justify-between` would
    // place the lone cluster at the START and move it on every tabbed screen.
    // The title is positioned absolutely either way and never participates.
    <header className="pt-safe relative z-30 flex items-center justify-end gap-2 px-5 pb-1">
      {backTo ? <HeaderBackButton fallback={backTo} /> : null}

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
