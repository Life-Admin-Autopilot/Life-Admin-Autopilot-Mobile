'use client'

import { usePathname } from 'next/navigation'

import { TabBar } from '@/components/ui/TabBar'
import { routeTab } from '@/lib/appRoutes'
import { useTabBarClaimed } from '@/lib/tabBarStore'

// Rendered once in Providers, as a sibling of the per-route `children` slot
// app/template.tsx re-mounts and fades on every navigation — that's what
// keeps the bar itself persistent across page transitions instead of
// fading out and back in with the page content above it.
export function AppTabBar() {
  const pathname = usePathname()
  const active = routeTab(pathname)
  // Stays mounted while a screen borrows the slot, so it slides back rather than
  // popping in when selection mode ends.
  const claimed = useTabBarClaimed()
  if (!active) return null
  return <TabBar active={active} hidden={claimed} />
}
