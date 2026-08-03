'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { LayoutGrid, ListChecks, FileText, User, Mic } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useVoiceCapture } from '@/lib/voice/captureStore'
import { env } from '@/lib/env'

// The unified floating tab bar — a stadium with five slots and the coral
// center action. The center is Voice: it opens the dynamic-island
// voice-capture surface.
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
  const t = useTranslations('nav')
  const openCapture = useVoiceCapture((s) => s.openCapture)
  return (
    <nav
      aria-hidden={hidden}
      // bottom-safe clears the iOS home indicator inside the Capacitor shell.
      className={cn(
        'bottom-safe fixed inset-x-0 z-30 mx-auto flex max-w-sm items-center justify-around rounded-pill bg-surface/90 px-2 py-2 shadow-elevated backdrop-blur-xl transition-[transform,opacity] duration-300 ease-out',
        hidden && 'pointer-events-none translate-y-28 opacity-0',
      )}
    >
      <Link href="/dashboard" aria-label={t('dashboard')}>
        <Tab icon={<LayoutGrid size={21} />} label={t('dashboard')} active={active === 'dashboard'} />
      </Link>
      <Link href="/matters" aria-label={t('matters')}>
        <Tab icon={<ListChecks size={21} />} label={t('matters')} active={active === 'matters'} />
      </Link>
      <button
        onClick={openCapture}
        aria-label={t('speakTo', { app: env.appName })}
        className="grid size-13 -translate-y-3 place-items-center rounded-full bg-accent text-accent-ink shadow-halo transition-transform active:scale-95"
      >
        <Mic size={22} strokeWidth={2} className="text-accent-ink" />
      </button>
      <Link href="/documents" aria-label={t('documents')}>
        <Tab icon={<FileText size={21} />} label={t('documents')} active={active === 'documents'} />
      </Link>
      <Link href="/profile" aria-label={t('profile')}>
        <Tab icon={<User size={21} />} label={t('profile')} active={active === 'profile'} />
      </Link>
    </nav>
  )
}

// The active tab sits inside a filled highlight capsule rather than just
// changing colour — the capsule is what makes the bar read as a stadium of
// slots instead of a row of icons.
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
      className={cn(
        'flex w-16 flex-col items-center gap-0.5 rounded-pill px-1 py-1.5 transition-colors',
        active ? 'bg-surface-sunken text-ink' : 'text-ink-subtle',
      )}
    >
      {icon}
      <span className="text-tab">{label}</span>
    </span>
  )
}
