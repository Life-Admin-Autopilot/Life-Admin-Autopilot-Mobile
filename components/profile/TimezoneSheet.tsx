'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ChipToggle, Sheet, SheetSection } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { useUpdateProfile } from '@/queries/profile'

// The zone Kitto uses when it decides what "today" means for you.
//
// This is not cosmetic. Reminders and the daily digest are generated on the
// server while your phone is asleep, and without a stored zone they can only
// assume UTC — which is how a matter due tonight gets announced as tomorrow's.

function detectedZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

function allZones(): string[] {
  // `supportedValuesOf` is ES2022 and present in every browser this app ships
  // to, but the WKWebView on an older iOS may not have it — fall back to just
  // the detected zone rather than rendering an empty list.
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf
  try {
    return supported ? supported('timeZone') : [detectedZone()]
  } catch {
    return [detectedZone()]
  }
}

function offsetLabel(zone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(now)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

export function TimezoneSheet({
  open,
  onClose,
  trigger,
  currentZone,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
  currentZone?: string
}) {
  const detected = detectedZone()
  const [selected, setSelected] = useState(currentZone ?? detected)
  const [query, setQuery] = useState('')
  const update = useUpdateProfile()

  useResetOnOpen(open, () => {
    setSelected(currentZone ?? detected)
    setQuery('')
  })

  const zones = useMemo(() => allZones(), [])
  const now = useMemo(() => new Date(), [])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, '_')
    const pool = needle ? zones.filter((z) => z.toLowerCase().includes(needle)) : zones
    // Capped: 400+ rows in a bottom sheet is a scroll nobody finishes, and the
    // search field is the real way through the list.
    return pool.slice(0, 60)
  }, [zones, query])

  const save = () => {
    if (selected === currentZone) {
      onClose()
      return
    }
    update.mutate(
      { timezone: selected },
      {
        onSuccess: () => {
          toast.success('Time zone saved.')
          onClose()
        },
        onError: (err) => toast.error(translateBackendError(err, "That didn't save.")),
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      height={560}
      eyebrow="Account"
      title="Time zone"
      footer={
        <Button
          variant="solid"
          className="w-full"
          disabled={update.isPending}
          onClick={save}
        >
          {update.isPending ? 'Saving…' : 'Save time zone'}
        </Button>
      }
    >
      <p className="text-body-sm text-ink-muted">
        Used for reminders and your daily summary, so they land on the right day.
      </p>

      <SheetSection label="On this device">
        <div className="flex flex-wrap gap-2">
          <ChipToggle selected={selected === detected} onClick={() => setSelected(detected)}>
            {detected} {offsetLabel(detected, now)}
          </ChipToggle>
        </div>
      </SheetSection>

      <SheetSection label="All zones">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search — city or region"
          aria-label="Search time zones"
        />
        <ul className="mt-1 flex flex-col">
          {matches.map((zone) => (
            <li key={zone}>
              <button
                type="button"
                onClick={() => setSelected(zone)}
                aria-pressed={selected === zone}
                className={
                  selected === zone
                    ? 'flex w-full items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2.5 text-left'
                    : 'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-surface-sunken'
                }
              >
                <span
                  className={
                    selected === zone
                      ? 'truncate text-body-sm font-bold text-accent'
                      : 'truncate text-body-sm text-ink'
                  }
                >
                  {zone.replace(/_/g, ' ')}
                </span>
                <span className="shrink-0 text-caption tabular text-ink-subtle">
                  {offsetLabel(zone, now)}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 ? (
            <li className="px-3 py-6 text-center text-body-sm text-ink-muted">
              No zone matches that.
            </li>
          ) : null}
        </ul>
      </SheetSection>
    </Sheet>
  )
}
