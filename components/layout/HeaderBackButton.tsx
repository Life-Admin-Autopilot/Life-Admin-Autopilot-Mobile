'use client'

import { ArrowLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

// The leading puck in AppHeader on screens opened from a tab rather than by
// tapping one. Same size, same hover treatment as the theme and bell pucks on
// the other side, so the header stays one row of controls rather than a row
// plus an odd extra.
//
// `router.back()` rather than a hardcoded href: the screen is reachable from
// more than one place over time, and returning someone to the top of
// /dashboard when they arrived from a matter would be a lie about where they
// were. `history.length` is checked first because a deep link — a notification
// tap in the Capacitor shell, a shared URL — opens the app straight onto this
// screen with nothing behind it, and back() there does nothing at all.
//
// The arrow is mirrored under RTL. Lucide has no logical-direction icon, and
// "back" in Arabic points right.
export function HeaderBackButton({ fallback }: { fallback: string }) {
  const t = useTranslations('common')
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => (window.history.length > 1 ? router.back() : router.replace(fallback))}
      aria-label={t('back')}
      // `me-auto` is what holds the leading edge — see the note in AppHeader on
      // why the header itself cannot switch to justify-between to do it.
      className="me-auto grid size-11 shrink-0 place-items-center rounded-full text-ink-muted outline-none transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <ArrowLeft size={20} strokeWidth={1.75} className="rtl:rotate-180" />
    </button>
  )
}
