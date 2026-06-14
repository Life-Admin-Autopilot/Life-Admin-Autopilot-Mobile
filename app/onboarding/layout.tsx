import { RouteGuard } from '@/components/auth/RouteGuard'

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard guard="onboarding">{children}</RouteGuard>
}
