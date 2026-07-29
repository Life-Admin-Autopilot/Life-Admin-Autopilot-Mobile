'use client'

import { useState } from 'react'

import { DomainIcon, type Domain } from '@/components/icons/DomainIcon'
import { useDomainLabels } from '@/hooks/useDomainLabels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
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
function syncSummary(result: IcsSyncResult): string {
  if (result.status === 'unchanged') return 'Already up to date.'
  if (result.status !== 'synced') return result.reason ?? 'That calendar could not be read.'

  const parts: string[] = []
  if (result.created > 0) parts.push(`${result.created} added`)
  if (result.updated > 0) parts.push(`${result.updated} updated`)
  if (parts.length === 0) parts.push('Nothing new')

  const base = parts.join(', ')
  if (result.needingConfirmation > 0) {
    return `${base}. ${result.needingConfirmation} need a time confirmed — they won't nudge you until you set one.`
  }
  return `${base}.`
}

function lastSyncedLabel(feed: IcsFeed): string {
  if (feed.status === 'gone') return 'This calendar no longer exists'
  if (feed.status === 'error') return feed.lastError ?? 'Last check failed'
  if (!feed.lastSyncedAt) return 'Not read yet'
  return `Last read ${new Date(feed.lastSyncedAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
}

function FeedRow({ feed }: { feed: IcsFeed }) {
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
            {lastSyncedLabel(feed)}
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
              onSuccess: (data) => toast.success(syncSummary(data.sync)),
              onError: (err) =>
                toast.error(translateBackendError(err, 'We could not read that calendar.')),
            })
          }}
        >
          {sync.isPending ? 'Reading…' : 'Read now'}
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
                    ? `Disconnected. ${data.retiredMatters} upcoming matters retired.`
                    : 'Disconnected.',
                ),
              onError: (err) =>
                toast.error(translateBackendError(err, 'We could not disconnect that calendar.')),
            })
          }}
        >
          Disconnect
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
          toast.success(syncSummary(data.sync))
          setUrl('')
          setLabel('')
        },
        onError: (err) =>
          toast.error(translateBackendError(err, 'We could not connect that calendar.')),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title="Calendars"
      // Two lines of coral caps shouted over the title and buried it. The
      // eyebrow is a label, not a sentence — the reassurance it was carrying
      // now sits in the section caption, where it reads at normal weight.
      eyebrow="Read-only"
    >
      <SheetSection label="Connected">
        <p className="text-caption text-ink-subtle">
          Kitto turns these into matters and reminds you. It never writes back to the calendar.
        </p>
        {feeds.isLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-surface-field" />
        ) : feeds.error ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-surface-field p-3.5">
            <span className="text-body-sm text-ink-muted">We could not load your calendars.</span>
            <Button variant="secondary" onClick={() => void feeds.refetch()}>
              Try again
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
            <span className="text-body-sm text-ink-muted">
              Nothing yet. Most schools and councils publish a calendar link — paste one below and
              Kitto will keep track of it.
            </span>
          </div>
        )}
      </SheetSection>

      <SheetSection label="Add a calendar">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Calendar link (webcal:// or https://…)"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="What is it? e.g. School terms"
          maxLength={80}
        />
      </SheetSection>

      <SheetSection label="File it under">
        <div className="flex flex-wrap gap-2">
          {DOMAINS.map((d) => (
            <ChipToggle key={d} selected={domain === d} onClick={() => setDomain(d)}>
              {domainLabels[d]}
            </ChipToggle>
          ))}
        </div>
      </SheetSection>

      <Button variant="solid" className="w-full" disabled={!canSubmit} onClick={submit}>
        {subscribe.isPending ? 'Connecting…' : 'Connect calendar'}
      </Button>
    </Sheet>
  )
}
