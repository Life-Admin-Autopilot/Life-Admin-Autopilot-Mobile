'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, AlarmClock, HelpCircle, FileText } from 'lucide-react'

import { MorphPanel } from '@/components/ui/MorphPanel'
import { useNotifications, useMarkNotificationsRead, type AppNotification } from '@/queries/notifications'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

const WIDTH = 312

export function NotificationBell() {
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
        aria-label="Notifications"
        aria-expanded={open}
        className="relative grid size-11 place-items-center rounded-full text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <Bell size={20} strokeWidth={1.75} />
        {unread > 0 ? (
          <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-micro text-accent-ink">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      <div className="absolute end-0 top-full z-40 mt-2">
        <MorphPanel open={open} width={WIDTH} height={height} radius={24}>
          <div className="flex h-full flex-col" style={{ width: WIDTH }}>
            <header className="flex items-center justify-between px-5 pb-2 pt-4">
              <span className="font-display text-heading-serif text-ink">Notifications</span>
            </header>
            {items.length === 0 ? (
              <p className="grid flex-1 place-items-center px-4 text-center text-body-sm text-ink-subtle">
                Nothing needs you right now.
              </p>
            ) : (
              <ul className="flex-1 overflow-y-auto">
                {items.map((n) => (
                  <NotificationRow key={n.id} n={n} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
        </MorphPanel>
      </div>
    </div>
  )
}

function NotificationRow({ n, onNavigate }: { n: AppNotification; onNavigate: () => void }) {
  const Icon = n.kind === 'uncertainty' ? HelpCircle : n.kind === 'document_scan' ? FileText : AlarmClock
  const body = (
    <div className="flex items-start gap-3 px-4 py-3">
      <Icon size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-body-sm font-medium text-ink">{n.title}</span>
        {n.body ? <span className="truncate text-caption text-ink-muted">{n.body}</span> : null}
        <span className="text-micro text-ink-subtle">{relativeTime(n.createdAt)}</span>
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
