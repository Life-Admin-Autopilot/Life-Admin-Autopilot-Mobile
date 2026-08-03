'use client'

import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetSection } from '@/components/ui/Sheet'
import { useIntlTag } from '@/lib/i18n/localeStore'
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

// Both take their translator as an argument rather than reading a hook: they are
// plain functions outside the component, and lib/i18n/translate.ts exists for
// exactly this shape. The separator comes from the catalogue too — Arabic lists
// take ، not a Latin comma.
type GoogleT = ReturnType<typeof useTranslations<'profile.google'>>

function syncSummary(result: GoogleSyncResult, t: GoogleT, separator: string): string {
  const created = result.calendar.created + result.tasks.created
  const updated = result.calendar.updated + result.tasks.updated

  const parts: string[] = []
  if (created > 0) parts.push(t('syncAdded', { count: created }))
  if (updated > 0) parts.push(t('syncUpdated', { count: updated }))
  if (parts.length === 0) parts.push(t('nothingNew'))

  // Meetings are counted but never filed. Saying so stops "I have 40 events and
  // Kitto only took 3" reading as a bug.
  const suffix =
    result.calendar.commitments > 0
      ? ` ${t('syncMeetingsLeft', { count: result.calendar.commitments })}`
      : ''

  return `${parts.join(separator)}.${suffix}`
}

function lastSyncLabel(integration: GoogleIntegration, t: GoogleT, intlTag: string): string {
  if (integration.status === 'needs_reauth') {
    return integration.lastError ?? t('reconnectHint')
  }
  if (!integration.calendarSyncedAt) return t('notImported')
  return t('lastImport', {
    date: new Date(integration.calendarSyncedAt).toLocaleDateString(intlTag, {
      day: 'numeric',
      month: 'short',
    }),
  })
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
  const t = useTranslations('profile.google')
  const tCommon = useTranslations('common')
  const intlTag = useIntlTag()
  const separator = tCommon('listSeparator')
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
        toast.success(t('connected'))
        void state.refetch()
      } else if (status === 'error') {
        toast.error(t('connectIncomplete'))
      }
      // 'cancelled' is silent — the user pressed Cancel and knows they did.
    })
    return () => {
      void handle.then((h) => h.remove())
    }
  }, [isNative, state, t])

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
        toast.error(translateBackendError(err, t('connectFailed'))),
    })
  }

  const integration = state.data?.integration ?? null
  const available = state.data?.available ?? false
  const hasCalendar = integration?.grantedScopes.includes(SCOPE_CALENDAR) ?? false
  const hasTasks = integration?.grantedScopes.includes(SCOPE_TASKS) ?? false

  return (
    <Sheet open={open} onClose={onClose} trigger={trigger} title={t('title')} eyebrow={t('eyebrow')}>
      <SheetSection label={t('account')}>
        <p className="text-caption text-ink-subtle">{t('explainer')}</p>

        {state.isLoading ? (
          <div className="h-16 animate-pulse rounded-2xl bg-surface-field" />
        ) : !available ? (
          <div className="rounded-2xl bg-surface-field p-3.5">
            <span className="text-body-sm text-ink-muted">{t('notEnabled')}</span>
          </div>
        ) : integration ? (
          <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-field p-3.5">
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-body font-bold text-ink">
                {integration.externalAccountEmail ?? t('fallbackAccount')}
              </span>
              <span
                className={
                  integration.status === 'active'
                    ? 'text-body-sm text-ink-muted'
                    : 'text-body-sm text-danger'
                }
              >
                {lastSyncLabel(integration, t, intlTag)}
              </span>
            </div>

            {/* A user can grant one scope and decline the other on the consent
                screen. Saying which landed beats a sync that silently imports
                half of what they expected. */}
            {integration.status === 'active' && !(hasCalendar && hasTasks) ? (
              <span className="text-caption text-warning">
                {hasCalendar ? t('tasksDeclined') : t('calendarDeclined')}
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
                    onSuccess: (data) => toast.success(syncSummary(data, t, separator)),
                    onError: (err) =>
                      toast.error(translateBackendError(err, t('importFailed'))),
                  })
                }
              >
                {sync.isPending ? t('importing') : t('importNow')}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() =>
                  disconnect.mutate(undefined, {
                    onSuccess: () => toast.success(t('disconnected')),
                    onError: (err) =>
                      toast.error(translateBackendError(err, t('disconnectFailed'))),
                  })
                }
              >
                {t('disconnect')}
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
            {connecting ? t('waiting') : t('connect')}
          </Button>
        )}
      </SheetSection>

      {integration?.status === 'needs_reauth' ? (
        <SheetSection label={t('reconnect')}>
          <p className="text-caption text-ink-subtle">{t('reauthExplainer')}</p>
          <Button variant="solid" className="w-full" onClick={startConnect}>
            {t('reconnectAction')}
          </Button>
        </SheetSection>
      ) : null}
    </Sheet>
  )
}
