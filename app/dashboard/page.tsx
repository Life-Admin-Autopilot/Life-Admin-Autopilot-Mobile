'use client'

import { ShieldCheck } from 'lucide-react'

import { AppHeader } from '@/components/layout/AppHeader'
import { HomeHero } from '@/components/dashboard/HomeHero'
import { MatterRow } from '@/components/dashboard/MatterRow'
import { ChatIsland } from '@/components/chat/ChatIsland'
import { VoiceIsland } from '@/components/voice/VoiceIsland'
import { TabBar } from '@/components/ui/TabBar'
import { UncertaintyBanner } from '@/components/uncertainty/UncertaintyBanner'
import { useSessionStore, selectUser } from '@/lib/auth/sessionStore'

function firstName(displayName?: string, email?: string): string {
  if (displayName && displayName.trim()) return displayName.trim().split(/\s+/)[0]
  if (email) return email.split('@')[0]
  return 'there'
}

// The home/dashboard — greets the onboarded user by name. Matters are static
// placeholders for now (no tasks API yet); the composition matches the design.
export default function DashboardPage() {
  const user = useSessionStore(selectUser)
  const name = firstName(user?.displayName, user?.email)

  return (
    <main className="min-h-dvh pb-28">
      <AppHeader />
      <HomeHero name={name} now={new Date()} />

      <div className="mx-auto mt-6 max-w-md px-6">
        <UncertaintyBanner />
      </div>

      <div className="mx-auto mt-8 flex max-w-md flex-col gap-3 px-6">
        <div className="flex items-baseline justify-between">
          <span className="text-label uppercase text-accent">Due today</span>
          <span className="text-caption text-ink-subtle">View all</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
          <MatterRow domain="car" title="Car Insurance Renewal" due="Due today · 10:00 AM" overdue />
          <div className="mx-4 h-px bg-border" />
          <MatterRow domain="finance" title="Credit Card Payment" due="Due today · 6:00 PM" />
          <div className="mx-4 h-px bg-border" />
          <MatterRow
            domain="home"
            title="Home Insurance Renewal"
            due="Due in 8 days · May 20"
            icon={<ShieldCheck size={18} className="text-ink-subtle" />}
          />
        </div>
      </div>

      <ChatIsland />
      <VoiceIsland />

      <TabBar active="dashboard" />
    </main>
  )
}
