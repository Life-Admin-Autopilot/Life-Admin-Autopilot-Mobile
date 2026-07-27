import { GhostLogo } from '@/components/ui/GhostLogo'
import { env } from '@/lib/env'

// Boot/redirect splash — the mascot while the session resolves. Its eyes are
// the load indicator: they keep looking around, which reads as waiting rather
// than stalled. No spinner (AGENTS.md → async states).
export function AppSplash() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6">
      <GhostLogo size={176} priority />
      <span className="font-wordmark text-wordmark text-ink-muted">{env.appName}</span>
    </main>
  )
}
