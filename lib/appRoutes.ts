// Which routes wear the persistent app chrome — the bottom tab bar and the
// panda chat FAB. Both are mounted once in Providers (siblings of the route
// slot) so they survive navigation, which means each has to decide for itself
// where it belongs.
//
// Signed-out and pre-app screens (/welcome, /sign-in, /sign-up, the root
// splash gate, /onboarding, /styleguide, /health) are deliberately excluded:
// they run their own morphing island and a floating "Ask the panda" medallion
// would both collide with it and offer the assistant to someone who has no
// session behind it.

export const ROUTE_TAB = {
  '/dashboard': 'dashboard',
  '/matters': 'matters',
  '/documents': 'documents',
  '/profile': 'profile',
} as const

export type AppTab = (typeof ROUTE_TAB)[keyof typeof ROUTE_TAB]

// next.config.ts sets trailingSlash: true (Capacitor static export), so
// usePathname() returns e.g. "/documents/" — strip it before lookup.
export function normalizeRoute(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function routeTab(pathname: string): AppTab | undefined {
  return ROUTE_TAB[normalizeRoute(pathname) as keyof typeof ROUTE_TAB]
}

// The tabbed surfaces plus the routes reached from them that still count as
// "inside the app" (RouteGuard guard="app").
const CHAT_ROUTES = new Set<string>([...Object.keys(ROUTE_TAB), '/uncertainties'])

export function isAppChatRoute(pathname: string): boolean {
  return CHAT_ROUTES.has(normalizeRoute(pathname))
}
