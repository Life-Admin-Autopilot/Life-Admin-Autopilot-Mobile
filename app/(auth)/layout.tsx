import { RouteGuard } from '@/components/auth/RouteGuard'

// Logged-out screens. If a session already exists, RouteGuard sends the user
// on to /onboarding or /dashboard.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard guard="guest">{children}</RouteGuard>
}
