'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { EmojiChip } from '@/components/ui/EmojiChip'
import { Pill } from '@/components/ui/Pill'
import { Sheet } from '@/components/ui/Sheet'
import { describeUserAgent } from '@/lib/device/describeUserAgent'
import { LIST_ITEM_VARIANTS } from '@/lib/motion'
import { formatScanTime } from '@/lib/scanTime'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { useRevokeOtherSessions, useRevokeSession, useSessions } from '@/queries/security'
import type { AppSession } from '@/queries/security'

// Everywhere your account is currently signed in, and the button that ends any
// of it. The one question this screen answers is "is any of these not me?", so
// each row leads with a device the user can recognise rather than the raw
// User-Agent the server stores.
//
// The IP is deliberately not shown. It answers no question a person actually
// has, it is wrong as often as it is right behind carrier NAT and VPNs, and a
// mismatched city is a great way to frighten someone for no reason.

export function DevicesSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const { data, isPending, isError, refetch } = useSessions()
  const revoke = useRevokeSession()
  const revokeOthers = useRevokeOtherSessions()
  const [busyId, setBusyId] = useState<string | null>(null)

  const sessions = data?.sessions ?? []
  // Current device first — it is the one the reader is holding, and it anchors
  // the list ("that's me, so what are these others?").
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current))
  const others = sessions.filter((s) => !s.current).length

  const revokeOne = (session: AppSession) => {
    setBusyId(session.id)
    revoke.mutate(session.id, {
      onSuccess: () => toast.success('Signed out.'),
      onError: (err) => toast.error(translateBackendError(err, "That didn't sign out.")),
      onSettled: () => setBusyId(null),
    })
  }

  const revokeRest = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () =>
        toast.success(others === 1 ? 'Signed out 1 device.' : `Signed out ${others} devices.`),
      onError: (err) => toast.error(translateBackendError(err, "That didn't sign out.")),
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={480}
      eyebrow="Security"
      title="Signed-in devices"
      footer={
        others > 0 ? (
          <Button
            variant="secondary"
            className="w-full"
            disabled={revokeOthers.isPending}
            onClick={revokeRest}
          >
            {revokeOthers.isPending ? 'Signing out…' : 'Sign out other devices'}
          </Button>
        ) : null
      }
    >
      {isPending ? (
        // Skeleton in the shape of the real row, not a spinner.
        <ul className="flex flex-col gap-2.5">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center gap-3.5 rounded-2xl bg-surface-sunken px-4 py-3.5">
              <div className="size-10 animate-pulse rounded-full bg-border-strong" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="h-4 w-1/2 animate-pulse rounded-pill bg-border-strong" />
                <div className="h-3 w-1/4 animate-pulse rounded-pill bg-border-strong" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="font-display text-heading-serif text-ink">Couldn&rsquo;t load your devices.</p>
          <Button variant="secondary" size="pill" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : ordered.length === 0 ? (
        <p className="py-10 text-center text-body text-ink-muted">Only this device.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {ordered.map((session) => {
              const device = describeUserAgent(session.userAgent)
              return (
                <motion.li
                  key={session.id}
                  layout="position"
                  variants={LIST_ITEM_VARIANTS}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="flex items-center gap-3.5 rounded-2xl bg-surface px-4 py-3.5 shadow-card"
                >
                  <EmojiChip emoji={device.emoji} category="periwinkle" size={40} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-heading-sm text-ink">{device.label}</span>
                    {session.lastUsedAt ? (
                      <span className="truncate text-body-sm text-ink-muted">
                        Last active {formatScanTime(session.lastUsedAt)}
                      </span>
                    ) : null}
                  </div>
                  {session.current ? (
                    <Pill tone="accent">This device</Pill>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revokeOne(session)}
                      disabled={busyId === session.id}
                      className="shrink-0 rounded-pill px-3 py-1.5 text-caption text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
                    >
                      {busyId === session.id ? 'Signing out…' : 'Sign out'}
                    </button>
                  )}
                </motion.li>
              )
            })}
          </AnimatePresence>
        </ul>
      )}
    </Sheet>
  )
}
