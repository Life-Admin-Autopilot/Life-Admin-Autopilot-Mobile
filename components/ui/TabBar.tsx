'use client'

import Link from 'next/link'
import { LayoutGrid, ListChecks, FileText, User, Mic } from 'lucide-react'

import { useVoiceCapture } from '@/lib/voice/captureStore'

// The unified floating tab bar — five slots with the purple center action. The
// center is Voice: it opens the dynamic-island voice-capture surface.
type TabKey = 'dashboard' | 'matters' | 'documents' | 'profile'

export function TabBar({
  active = 'dashboard',
  hidden = false,
}: {
  active?: TabKey
  /**
   * Slides the bar out of its slot so another surface can occupy it (matters'
   * selection action bar). Kept mounted and moved by a transform ON THE FIXED
   * ELEMENT ITSELF — wrapping it in an animated ancestor would make that
   * ancestor the containing block and break `fixed` outright, the same way
   * PhoneFrame's transform does.
   */
  hidden?: boolean
}) {
  const openCapture = useVoiceCapture((s) => s.openCapture)
  return (
    <nav
      aria-hidden={hidden}
      className={`fixed inset-x-0 bottom-4 z-30 mx-auto flex max-w-sm items-center justify-around rounded-pill border border-border bg-surface/90 px-2 py-2 shadow-elevated backdrop-blur transition-[transform,opacity] duration-300 ease-out ${
        hidden ? 'pointer-events-none translate-y-28 opacity-0' : ''
      }`}
    >
      <Link href="/dashboard" aria-label="Dashboard">
        <Tab icon={<LayoutGrid size={22} />} label="Dashboard" active={active === 'dashboard'} />
      </Link>
      <Link href="/matters" aria-label="Matters">
        <Tab icon={<ListChecks size={22} />} label="Matters" active={active === 'matters'} />
      </Link>
      <button
        onClick={openCapture}
        aria-label="Speak to the panda"
        className="grid size-12 -translate-y-3 place-items-center rounded-full bg-accent text-accent-ink shadow-elevated"
      >
        <Mic size={22} className="text-accent-ink" />
      </button>
      <Link href="/documents" aria-label="Documents">
        <Tab icon={<FileText size={22} />} label="Documents" active={active === 'documents'} />
      </Link>
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
