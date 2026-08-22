// Which routes wear the persistent app chrome — the bottom tab bar and the
// chat FAB. Both are mounted once in Providers (siblings of the route
// slot) so they survive navigation, which means each has to decide for itself
// where it belongs.
//
// Signed-out and pre-app screens (/welcome, /sign-in, /sign-up, the root
// splash gate, /onboarding, /styleguide, /health) are deliberately excluded:
// they run their own morphing island and a floating "Ask <app name>" medallion
// would both collide with it and offer the assistant to someone who has no
// session behind it.

/**
 * Where a session ending puts you.
 *
 * <b>Sign-in, not /welcome.</b> /welcome is the FRONT DOOR — the mascot, the
 * creed, and "Create account" as its primary button. That is the right screen
 * for someone who has never been here, and the wrong one for someone who just
 * signed out: they have an account, they were offered the button for making a
 * second one, and getting back in cost an extra tap through a screen selling
 * them something they already own.
 *
 * Every route that can be reached with no session was reached WITH one a moment
 * ago — a first-time visitor arrives at `/` and is sent to /welcome from there,
 * never to /dashboard. So "the session ended" and "you have an account" are the
 * same fact, and this is the screen that acts on it.
 *
 * Deliberately NOT used by two places. `app/page.tsx` is the front door's own
 * entrance and keeps /welcome. Deleting an account keeps it too: there is
 * nothing left to sign in to, and offering the form would be a dead end.
 */
export const SIGNED_OUT_ROUTE = '/sign-in'

export const ROUTE_TAB = {
  '/dashboard': 'dashboard',
  '/matters': 'matters',
  '/documents': 'documents',
  '/profile': 'profile',
} as const

export type AppTab = (typeof ROUTE_TAB)[keyof typeof ROUTE_TAB]

// Screens that are not tabs of their own but are opened FROM one, and are still
// the same place as far as the person is concerned. They keep the bar mounted
// with their parent tab lit rather than dropping the app's chrome entirely —
// /money is the whole of a dashboard card, so losing the bar on the way in left
// the screen with no way out but the browser's own back gesture.
//
// Such a screen also wears a back puck in its header (AppHeader's `back` prop),
// because a lit tab that is not the current screen cannot be the way back on its
// own: tapping Home from /money goes to /dashboard's top, not to where the
// person was.
const ROUTE_PARENT_TAB = {
  '/money': 'dashboard',
} as const satisfies Record<string, AppTab>

// next.config.ts sets trailingSlash: true (Capacitor static export), so
// usePathname() returns e.g. "/documents/" — strip it before lookup.
export function normalizeRoute(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function routeTab(pathname: string): AppTab | undefined {
  const route = normalizeRoute(pathname)
  return (
    ROUTE_TAB[route as keyof typeof ROUTE_TAB] ??
    ROUTE_PARENT_TAB[route as keyof typeof ROUTE_PARENT_TAB]
  )
}

// The tabbed surfaces plus the routes reached from them that still count as
// "inside the app" (RouteGuard guard="app").
const CHAT_ROUTES = new Set<string>([
  ...Object.keys(ROUTE_TAB),
  ...Object.keys(ROUTE_PARENT_TAB),
  '/uncertainties',
])

export function isAppChatRoute(pathname: string): boolean {
  return CHAT_ROUTES.has(normalizeRoute(pathname))
}
