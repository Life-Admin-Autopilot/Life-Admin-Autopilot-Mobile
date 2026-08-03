'use client'

import { useFormatter, useNow, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, AlarmClock, HelpCircle, FileText } from 'lucide-react'

import { MorphPanel } from '@/components/ui/MorphPanel'
import { useNotifications, useMarkNotificationsRead, type AppNotification } from '@/queries/notifications'

const WIDTH = 312
const MINUTE_MS = 60_000

export function NotificationBell() {
  const t = useTranslations('lib')
  // One clock for the whole panel. `Date.now()` in a row's render body is an
  // impure read, and a `now` frozen at mount would leave every row saying "now"
  // an hour later. A minute is the finest granularity relativeTime shows here,
  // and useNotifications already re-renders this tree on the same cadence.
  const now = useNow({ updateInterval: MINUTE_MS })
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()

  const unread = data?.unreadCount ?? 0
  const items = data?.notifications ?? []
  const height = Math.min(360, 56 + Math.max(1, items.length) * 64)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && unread > 0) markRead.mutate(undefined)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-label={t('bell.title')}
        aria-expanded={open}
        className="relative grid size-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <Bell size={20} strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-micro text-accent-ink">
            {/* The overflow marker is a catalogue string, not a literal: the
                sign sits after the digit in English and before it in Arabic. */}
            {unread > 9 ? t('bell.unreadOverflow') : unread}
          </span>
        ) : null}
      </button>

      <div className="absolute end-0 top-full z-40 mt-2">
        <MorphPanel open={open} width={WIDTH} height={height} radius={24}>
          <div className="flex h-full flex-col" style={{ width: WIDTH }}>
            <header className="flex items-center justify-between px-5 pb-2 pt-4">
              <span className="font-display text-heading-serif text-ink">{t('bell.title')}</span>
            </header>
            {items.length === 0 ? (
              <p className="grid flex-1 place-items-center px-4 text-center text-body-sm text-ink-subtle">
                {t('bell.empty')}
              </p>
            ) : (
              <ul className="flex-1 overflow-y-auto">
                {items.map((n) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    now={now}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>
        </MorphPanel>
      </div>
    </div>
  )
}

function NotificationRow({
  n,
  now,
  onNavigate,
}: {
  n: AppNotification
  now: Date
  onNavigate: () => void
}) {
  // next-intl's relativeTime wraps Intl.RelativeTimeFormat, which already owns
  // "2 hours ago", "منذ ساعتين" and the unit ladder. The hand-rolled version it
  // replaces produced "2h ago" in every language and had no way to express
  // Arabic's dual — and this needs no catalogue keys at all.
  const format = useFormatter()
  const Icon = n.kind === 'uncertainty' ? HelpCircle : n.kind === 'document_scan' ? FileText : AlarmClock
  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-body-sm font-medium text-ink">{n.title}</span>
        {n.body ? <span className="truncate text-caption text-ink-muted">{n.body}</span> : null}
        <span className="text-micro text-ink-subtle">
          {format.relativeTime(new Date(n.createdAt), now)}
        </span>
      </div>
    </div>
  )
  if (n.kind === 'uncertainty') {
    return (
      <li className="mx-2 rounded-xl hover:bg-surface-sunken">
        <Link href="/uncertainties" onClick={onNavigate}>
          {body}
        </Link>
      </li>
    )
  }
  if (n.kind === 'document_scan') {
    return (
      <li className="mx-2 rounded-xl hover:bg-surface-sunken">
        <Link href="/documents" onClick={onNavigate}>
          {body}
        </Link>
      </li>
    )
  }
  return <li className="mx-2">{body}</li>
}
