'use client'

import { usePathname } from 'next/navigation'

import { TabBar } from '@/components/ui/TabBar'
import { routeTab } from '@/lib/appRoutes'
import { useTabBarClaimed } from '@/lib/tabBarStore'

// Rendered once in Providers, as a sibling of — not inside — the PageTransition
// that closes and re-opens the routed page on every navigation. That's what
// keeps the bar itself persistent across page transitions instead of animating
// out and back in with the page content above it. It reads `usePathname()` to
// pick the active tab, and since it sits above the transition it simply
// re-renders with the new path rather than remounting.
export function AppTabBar() {
  const pathname = usePathname()
  const active = routeTab(pathname)
  // Stays mounted while a screen borrows the slot, so it slides back rather than
  // popping in when selection mode ends.
  const claimed = useTabBarClaimed()
  if (!active) return null
  return <TabBar active={active} hidden={claimed} />
}
