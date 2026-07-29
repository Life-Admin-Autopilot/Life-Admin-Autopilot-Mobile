'use client'

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetSection } from '@/components/ui/Sheet'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import {
  SCOPE_CALENDAR,
  SCOPE_TASKS,
  useDisconnectGoogle,
  useGoogleAuthorizeUrl,
  useGoogleIntegration,
  useSyncGoogle,
  type GoogleIntegration,
  type GoogleSyncResult,
} from '@/queries/googleIntegration'

// Connect a Google account so Kitto can read its calendar and tasks.
//
// Read-only, and the copy says so plainly — asking for access to someone's
// calendar is the largest trust request in the app, and burying what it does
// would be the wrong trade for a product whose whole promise is safekeeping.

function syncSummary(result: GoogleSyncResult): string {
  const created = result.calendar.created + result.tasks.created
  const updated = result.calendar.updated + result.tasks.updated

  const parts: string[] = []
  if (created > 0) parts.push(`${created} added`)
  if (updated > 0) parts.push(`${updated} updated`)
  if (parts.length === 0) parts.push('Nothing new')

  // Meetings are counted but never filed. Saying so stops "I have 40 events and
  // Kitto only took 3" reading as a bug.
  const suffix =
    result.calendar.commitments > 0
      ? ` ${result.calendar.commitments} meetings left alone — they already remind you.`
      : ''

  return `${parts.join(', ')}.${suffix}`
}

function lastSyncLabel(integration: GoogleIntegration): string {
  if (integration.status === 'needs_reauth') {
    return integration.lastError ?? 'Reconnect to keep importing'
  }
  if (!integration.calendarSyncedAt) return 'Not imported yet'
  return `Last import ${new Date(integration.calendarSyncedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
}

export function GoogleAccountSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const state = useGoogleIntegration()
  const authorize = useGoogleAuthorizeUrl()
  const sync = useSyncGoogle()
  const disconnect = useDisconnectGoogle()
  const [connecting, setConnecting] = useState(false)

  const isNative = Capacitor.isNativePlatform()

  // The return leg. On native the server redirects to kitto://, which arrives
  // here; on web there is no deep link, so the tab is closed by hand and the
  // refetch below rides on window focus instead.
  useEffect(() => {
    if (!isNative) return
    const handle = App.addListener('appUrlOpen', ({ url }) => {
      if (!url.includes('integrations/google')) return
      void Browser.close()
      setConnecting(false)

      const status = new URL(url.replace('kitto://', 'https://')).searchParams.get('status')
      if (status === 'connected') {
        toast.success('Google connected.')
        void state.refetch()
      } else if (status === 'error') {
        toast.error('That connection did not complete.')
      }
      // 'cancelled' is silent — the user pressed Cancel and knows they did.
    })
    return () => {
      void handle.then((h) => h.remove())
    }
  }, [isNative, state])

  // Web has no deep link, so returning focus is the only signal the tab is done.
  useEffect(() => {
    if (isNative || !connecting) return
    const onFocus = (): void => {
      setConnecting(false)
      void state.refetch()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [isNative, connecting, state])

  const startConnect = (): void => {
    authorize.mutate(!isNative, {
      onSuccess: async ({ url }) => {
        setConnecting(true)
        if (isNative) {
          await Browser.open({ url })
        } else {
          // A new tab, not a redirect: replacing the SPA would drop the session
          // the user is halfway through.
          window.open(url, '_blank', 'noopener')
        }
      },
      onError: (err) =>
        toast.error(translateBackendError(err, 'We could not start that connection.')),
    })
  }

  const integration = state.data?.integration ?? null
  const available = state.data?.available ?? false
  const hasCalendar = integration?.grantedScopes.includes(SCOPE_CALENDAR) ?? false
  const hasTasks = integration?.grantedScopes.includes(SCOPE_TASKS) ?? false

  return (
    <Sheet open={open} onClose={onClose} trigger={trigger} title="Google" eyebrow="Read-only">
      <SheetSection label="Account">
        <p className="text-caption text-ink-subtle">
          Kitto reads your calendar and tasks, turns them into matters, and reminds you. It never
          changes anything in Google.
        </p>

        {state.isLoading ? (
          <div className="h-16 animate-pulse rounded-2xl bg-surface-field" />
        ) : !available ? (
          <div className="rounded-2xl bg-surface-field p-3.5">
            <span className="text-body-sm text-ink-muted">
              Connecting a Google account isn&rsquo;t switched on yet.
            </span>
          </div>
        ) : integration ? (
          <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-field p-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-body font-bold text-ink">
                {integration.externalAccountEmail ?? 'Google account'}
              </span>
              <span
                className={
                  integration.status === 'active'
                    ? 'text-body-sm text-ink-muted'
                    : 'text-body-sm text-danger'
                }
              >
                {lastSyncLabel(integration)}
              </span>
            </div>

            {/* A user can grant one scope and decline the other on the consent
                screen. Saying which landed beats a sync that silently imports
                half of what they expected. */}
            {integration.status === 'active' && !(hasCalendar && hasTasks) ? (
              <span className="text-caption text-warning">
                {hasCalendar ? 'Tasks access was declined.' : 'Calendar access was declined.'}
              </span>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={sync.isPending || integration.status !== 'active'}
                onClick={() =>
                  sync.mutate(undefined, {
                    onSuccess: (data) => toast.success(syncSummary(data)),
                    onError: (err) =>
                      toast.error(translateBackendError(err, 'That import did not finish.')),
                  })
                }
              >
                {sync.isPending ? 'Importing…' : 'Import now'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, {
                    onSuccess: () => toast.success('Google disconnected.'),
                    onError: (err) =>
                      toast.error(translateBackendError(err, 'We could not disconnect that.')),
                  })
                }
              >
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="solid"
            className="w-full"
            disabled={authorize.isPending || connecting}
            onClick={startConnect}
          >
            {connecting ? 'Waiting for Google…' : 'Connect Google'}
          </Button>
        )}
      </SheetSection>

      {integration?.status === 'needs_reauth' ? (
        <SheetSection label="Reconnect">
          <p className="text-caption text-ink-subtle">
            Google stopped accepting Kitto&rsquo;s access — usually because it was removed from your
            Google account, or a password changed.
          </p>
          <Button variant="solid" className="w-full" onClick={startConnect}>
            Reconnect Google
          </Button>
        </SheetSection>
      ) : null}
    </Sheet>
  )
}
