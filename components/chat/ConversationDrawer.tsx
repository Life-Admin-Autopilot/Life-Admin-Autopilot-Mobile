'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'

import { useNow } from '@/hooks/useNow'
import { cn } from '@/lib/cn'
import { formatRelativeTime } from '@/lib/i18n/dateFormat'
import { useIntlTag } from '@/lib/i18n/localeStore'
import type { AiThreadSummary } from '@/lib/ai/types'

// The history drawer — the panel's second surface, slid over the transcript.
//
// It stays INSIDE the island rather than becoming a route: the island floats
// over whatever screen the user is on, and sending them to a full-page chat
// list to pick a thread would cost them the screen they were working from.
//
// Slid with a CSS transform, not framer-motion. The morph primitives own the
// island's own geometry; a child sliding over it is exactly the "small,
// GPU-friendly transform/opacity effect" CSS transitions are sanctioned for,
// and it honours prefers-reduced-motion through the motion-reduce variant.

interface ConversationDrawerProps {
  open: boolean
  onClose: () => void
  threads: AiThreadSummary[]
  isLoading: boolean
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onRename: (thread: AiThreadSummary) => void
  onDelete: (thread: AiThreadSummary) => void
}

export function ConversationDrawer({
  open,
  onClose,
  threads,
  isLoading,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: ConversationDrawerProps) {
  const t = useTranslations('chat')
  const tag = useIntlTag()
  const now = useNow()
  // Which row has its actions revealed. One at a time — a row menu open on
  // every row would leave the list unreadable in a 330px-wide panel.
  const [menuFor, setMenuFor] = useState<string | null>(null)

  return (
    <div
      // Always mounted so the slide has something to animate; `inert` keeps the
      // closed drawer out of the tab order and off the screen reader, which
      // `hidden` would do too — but hidden cannot transition.
      inert={!open}
      aria-label={t('threads.title')}
      className={cn(
        'absolute inset-0 z-10 flex flex-col bg-surface transition-transform duration-200 ease-out motion-reduce:transition-none',
        // Logical translation: the drawer parks off the start edge, which is
        // the LEFT in English and the RIGHT in Arabic.
        open ? 'translate-x-0' : 'rtl:translate-x-full ltr:-translate-x-full',
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-heading-sm text-ink">{t('threads.title')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('threads.close')}
          className="grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>

      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-body-sm text-ink transition-colors hover:bg-surface-field"
        >
          <Plus size={16} strokeWidth={1.75} />
          {t('threads.new')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {isLoading ? (
          <ThreadSkeleton />
        ) : threads.length === 0 ? (
          <p className="px-1 py-6 text-center text-caption text-ink-subtle">
            {t('threads.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {threads.map((thread) => {
              const isActive = thread.id === activeId
              const isMenuOpen = menuFor === thread.id
              return (
                <li key={thread.id} className="relative">
                  <div
                    className={cn(
                      'flex items-center gap-1 rounded-xl transition-colors',
                      isActive ? 'bg-surface-field' : 'hover:bg-surface-sunken',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(null)
                        onSelect(thread.id)
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      className="min-w-0 flex-1 px-3 py-2 text-start"
                    >
                      <span className="block truncate text-body-sm text-ink" dir="auto">
                        {thread.title ?? t('threads.untitled')}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-subtle">
                        {now !== null ? (
                          <span className="shrink-0">
                            {formatRelativeTime(Date.parse(thread.updatedAt) - now, tag)}
                          </span>
                        ) : null}
                        {thread.preview ? (
                          <>
                            {now !== null ? <span aria-hidden>·</span> : null}
                            <span className="truncate" dir="auto">
                              {thread.preview}
                            </span>
                          </>
                        ) : null}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMenuFor(isMenuOpen ? null : thread.id)}
                      aria-label={t('threads.actions')}
                      aria-expanded={isMenuOpen}
                      className="me-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface hover:text-ink"
                    >
                      <MoreHorizontal size={15} strokeWidth={1.75} />
                    </button>
                  </div>

                  {isMenuOpen ? (
                    <div className="mt-1 flex gap-1 px-3 pb-1">
                      <RowAction
                        icon={<Pencil size={13} strokeWidth={1.75} />}
                        label={t('threads.rename')}
                        onClick={() => {
                          setMenuFor(null)
                          onRename(thread)
                        }}
                      />
                      <RowAction
                        icon={<Trash2 size={13} strokeWidth={1.75} />}
                        label={t('threads.delete')}
                        tone="danger"
                        onClick={() => {
                          setMenuFor(null)
                          onDelete(thread)
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function RowAction({
  icon,
  label,
  onClick,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-caption transition-colors',
        tone === 'danger'
          ? 'bg-danger-soft text-danger hover:bg-danger-soft/80'
          : 'bg-surface-sunken text-ink-muted hover:text-ink',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// Matches the real row shape (two lines, same paddings) rather than a spinner.
function ThreadSkeleton() {
  return (
    <ul className="flex flex-col gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="animate-pulse px-3 py-2">
          <span className="block h-3.5 w-2/3 rounded-pill bg-surface-sunken" />
          <span className="mt-2 block h-2.5 w-1/2 rounded-pill bg-surface-sunken" />
        </li>
      ))}
    </ul>
  )
}
