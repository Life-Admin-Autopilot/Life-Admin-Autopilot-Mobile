import { Menu } from 'lucide-react'

import { NotificationBell } from '@/components/notifications/NotificationBell'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

// Centered wordmark header — the brand chrome at the top of app screens.
export function AppHeader() {
  return (
    <header className="flex items-center justify-between px-6 pt-6">
      <Menu size={22} className="text-ink-muted" />
      <div className="flex flex-col items-center gap-1">
        <span className="text-label uppercase text-ink-subtle">Life Admin</span>
        <span className="font-wordmark text-wordmark leading-none text-ink">Autopilot</span>
      </div>
      <div className="flex items-center gap-4">
        <NotificationBell />
      </div>
    </header>
  )
}
