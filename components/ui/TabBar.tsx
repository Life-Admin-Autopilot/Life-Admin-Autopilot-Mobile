'use client'

import { LayoutGrid, ListChecks, FileText, User, Mic } from 'lucide-react'

import { useVoiceCapture } from '@/lib/voice/captureStore'

// The unified floating tab bar — five slots with the crimson center action. The
// center is Voice: it opens the dynamic-island voice-capture surface.
type TabKey = 'dashboard' | 'matters' | 'documents' | 'profile'

export function TabBar({ active = 'dashboard' }: { active?: TabKey }) {
  const openCapture = useVoiceCapture((s) => s.openCapture)
  return (
    <nav className="fixed inset-x-0 bottom-4 z-30 mx-auto flex max-w-sm items-center justify-around rounded-pill border border-border bg-surface/90 px-2 py-2 shadow-elevated backdrop-blur">
      <Tab icon={<LayoutGrid size={22} />} label="Dashboard" active={active === 'dashboard'} />
      <Tab icon={<ListChecks size={22} />} label="Matters" active={active === 'matters'} />
      <button
        onClick={openCapture}
        aria-label="Speak to the King"
        className="grid size-12 -translate-y-3 place-items-center rounded-full bg-accent text-accent-ink shadow-elevated"
      >
        <Mic size={22} className="text-accent-ink" />
      </button>
      <Tab icon={<FileText size={22} />} label="Documents" active={active === 'documents'} />
      <Tab icon={<User size={22} />} label="Profile" active={active === 'profile'} />
    </nav>
  )
}

function Tab({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
}) {
  return (
    <span
      className={`flex w-14 flex-col items-center gap-0.5 ${active ? 'text-accent' : 'text-ink-subtle'}`}
    >
      {icon}
      <span className="text-micro">{label}</span>
    </span>
  )
}
