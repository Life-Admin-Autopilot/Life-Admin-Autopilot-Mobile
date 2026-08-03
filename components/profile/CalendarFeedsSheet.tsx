'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { useDomainLabels } from '@/hooks/useDomainLabels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import {
  useIcsFeeds,
  useRemoveIcsFeed,
  useSubscribeIcsFeed,
  useSyncIcsFeed,
  type IcsFeed,
  type IcsSyncResult,
} from '@/queries/icsFeeds'

// Calendars Kitto reads — school terms, bin collections, fixtures.
//
// Read-only by design. Kitto never writes to these; it turns their events into
// matters and nudges you about them. The feed stays authoritative for WHEN, you
// stay authoritative for WHAT — rename a matter and the next sync leaves your
// title alone.

const DOMAINS: Domain[] = ['family', 'home', 'car', 'health', 'finance', 'pets']

// What actually landed, in the user's terms. `needingConfirmation` is the part
// that must never be swallowed: those events carried a time with no timezone,
// so Kitto filed them without a nudge rather than guessing and firing at the
// wrong hour.
// Both take the translator as an argument — they are plain functions outside the
// component, which is the shape lib/i18n/translate.ts exists for. The list
// separator comes from the catalogue too, because Arabic joins with ، not a
// Latin comma.
type CalendarT = ReturnType<typeof useTranslations<'profile.calendars'>>

function syncSummary(result: IcsSyncResult, t: CalendarT, separator: string): string {
  if (result.status === 'unchanged') return t('upToDate')
  if (result.status !== 'synced') return result.reason ?? t('unreadable')

  const parts: string[] = []
  if (result.created > 0) parts.push(t('syncAdded', { count: result.created }))
  if (result.updated > 0) parts.push(t('syncUpdated', { count: result.updated }))
  if (parts.length === 0) parts.push(t('nothingNew'))

  const base = parts.join(separator)
  if (result.needingConfirmation > 0) {
    return `${base}. ${t('needTimeConfirmed', { count: result.needingConfirmation })}`
  }
  return `${base}.`
}

function lastSyncedLabel(feed: IcsFeed, t: CalendarT, intlTag: string): string {
  if (feed.status === 'gone') return t('gone')
  if (feed.status === 'error') return feed.lastError ?? t('lastCheckFailed')
  if (!feed.lastSyncedAt) return t('notReadYet')
  return t('lastRead', {
    date: new Date(feed.lastSyncedAt).toLocaleDateString(intlTag, {
      day: 'numeric',
      month: 'short',
    }),
  })
}

function FeedRow({ feed }: { feed: IcsFeed }) {
  const t = useTranslations('profile.calendars')
  const tCommon = useTranslations('common')
  const intlTag = useIntlTag()
  const separator = tCommon('listSeparator')
  const sync = useSyncIcsFeed()
  const remove = useRemoveIcsFeed()
  const unhealthy = feed.status !== 'active'

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-surface-field p-3.5">
      <div className="flex items-start gap-3">
        <DomainIcon domain={feed.domain as Domain} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-body font-bold text-ink">{feed.label}</span>
          <span className={unhealthy ? 'text-body-sm text-danger' : 'text-body-sm text-ink-muted'}>
            {lastSyncedLabel(feed, t, intlTag)}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        {/* `outline` rather than `secondary`: secondary is bg-surface-field,
            which is this card's own background — the control would vanish into
            the surface it sits on. */}
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={sync.isPending || feed.status === 'gone'}
          onClick={() => {
            sync.mutate(feed.id, {
              onSuccess: (data) => toast.success(syncSummary(data.sync, t, separator)),
              onError: (err) =>
                toast.error(translateBackendError(err, t('readFailed'))),
            })
          }}
        >
          {sync.isPending ? t('reading') : t('readNow')}
        </Button>
        {/* Destructive, and it must look it — disconnecting also retires this
            calendar's upcoming matters. Rendering it identically to "Read now"
            told the user nothing about which one they cannot undo. */}
        <Button
          variant="destructive"
          size="sm"
          disabled={remove.isPending}
          onClick={() => {
            remove.mutate(feed.id, {
              onSuccess: (data) =>
                toast.success(
                  data.retiredMatters > 0
                    ? t('disconnectedRetired', { count: data.retiredMatters })
                    : t('disconnected'),
                ),
              onError: (err) =>
                toast.error(translateBackendError(err, t('disconnectFailed'))),
            })
          }}
        >
          {t('disconnect')}
        </Button>
      </div>
    </div>
  )
}

export function CalendarFeedsSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const t = useTranslations('profile.calendars')
  const tCommon = useTranslations('common')
  const separator = tCommon('listSeparator')
  const domainLabels = useDomainLabels()
  const feeds = useIcsFeeds()
  const subscribe = useSubscribeIcsFeed()

  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [domain, setDomain] = useState<Domain>('family')

  // An abandoned draft must not be waiting the next time this opens.
  useResetOnOpen(open, () => {
    setUrl('')
    setLabel('')
    setDomain('family')
  })

  const canSubmit = url.trim().length > 0 && label.trim().length > 0 && !subscribe.isPending

  const submit = () => {
    if (!canSubmit) return
    subscribe.mutate(
      { url: url.trim(), label: label.trim(), domain },
      {
        onSuccess: (data) => {
          toast.success(syncSummary(data.sync, t, separator))
          setUrl('')
          setLabel('')
        },
        onError: (err) =>
          toast.error(translateBackendError(err, t('connectFailed'))),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title={t('title')}
      // Two lines of coral caps shouted over the title and buried it. The
      // eyebrow is a label, not a sentence — the reassurance it was carrying
      // now sits in the section caption, where it reads at normal weight.
      eyebrow={t('eyebrow')}
    >
      <SheetSection label={t('connected')}>
        <p className="text-caption text-ink-subtle">{t('explainer')}</p>
        {feeds.isLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-surface-field" />
        ) : feeds.error ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-field p-3.5">
            <span className="text-body-sm text-ink-muted">{t('loadFailed')}</span>
            <Button variant="secondary" onClick={() => void feeds.refetch()}>
              {tCommon('tryAgain')}
            </Button>
          </div>
        ) : feeds.data && feeds.data.feeds.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {feeds.data.feeds.map((feed) => (
              <FeedRow key={feed.id} feed={feed} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-field p-3.5">
            <span className="text-body-sm text-ink-muted">{t('empty')}</span>
          </div>
        )}
      </SheetSection>

      <SheetSection label={t('addLabel')}>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('namePlaceholder')}
          maxLength={80}
        />
      </SheetSection>

      <SheetSection label={t('fileUnder')}>
        <div className="flex flex-wrap gap-2">
          {DOMAINS.map((d) => (
            <ChipToggle key={d} selected={domain === d} onClick={() => setDomain(d)}>
              {domainLabels[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <Button variant="solid" className="w-full" disabled={!canSubmit} onClick={submit}>
        {subscribe.isPending ? t('connecting') : t('connect')}
      </Button>
    </Sheet>
  )
}
