import { RouteGuard } from '@/components/auth/RouteGuard'

export default function UncertaintiesLayout({ children }: { children: React.ReactNode }) {
  return <RouteGuard guard="app">{children}</RouteGuard>
}
