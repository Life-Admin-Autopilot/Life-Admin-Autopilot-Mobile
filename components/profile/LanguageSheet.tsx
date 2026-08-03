'use client'

import { Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetSection } from '@/components/ui/Sheet'
import { useResetOnOpen } from '@/hooks/useResetOnOpen'
import { LOCALES, LOCALE_META, type Locale } from '@/lib/i18n/locales'
import {
  deviceLocale,
  useFollowDevice,
  useIsExplicitLocale,
  useLocale,
  useSetLocale,
} from '@/lib/i18n/localeStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { useUpdateProfile } from '@/queries/profile'

// The language Kitto reads and writes in.
//
// Nothing is applied until the server confirms. The store's precedence puts
// `User.locale` above the local choice, so a language applied locally while the
// PATCH failed would silently undo itself on the next launch — worse than a
// second of "Saving…". On success the account write and the local apply happen
// together, and the whole app (including what the model writes back) turns over.
//
// "Follow the device" is a real third option, not English by another name: it
// stores null and keeps tracking the phone's setting afterwards.

/** `device` is the absence of a choice — stored as null on the account. */
type Choice = Locale | 'device'

function LanguageOption({
  selected,
  onSelect,
  endonym,
  meta,
  lang,
}: {
  selected: boolean
  onSelect: () => void
  endonym: string
  /** English name, shown only when it differs from the endonym. */
  meta?: string
  lang: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        selected
          ? 'flex w-full items-center justify-between gap-3 rounded-2xl bg-accent-soft px-3.5 py-3 text-start'
          : 'flex w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-3 text-start hover:bg-surface-sunken'
      }
    >
      <span className="min-w-0">
        {/* The endonym carries its own language, so it renders in its own script
            regardless of the app's current direction — `lang` is what lets the
            Arabic stack in globals.css claim it while the UI is still English. */}
        <span
          lang={lang}
          className={
            selected
              ? 'block truncate text-body font-bold text-accent'
              : 'block truncate text-body text-ink'
          }
        >
          {endonym}
        </span>
        {meta ? <span className="block truncate text-caption text-ink-subtle">{meta}</span> : null}
      </span>
      {selected ? <Check size={18} className="shrink-0 text-accent" /> : null}
    </button>
  )
}

export function LanguageSheet({
  open,
  onClose,
  trigger,
}: {
  open: boolean
  onClose: () => void
  trigger?: DOMRect | null
}) {
  const t = useTranslations('language')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const isExplicit = useIsExplicitLocale()
  const setLocale = useSetLocale()
  const followDevice = useFollowDevice()
  const update = useUpdateProfile()

  const active: Choice = isExplicit ? locale : 'device'
  const [selected, setSelected] = useState<Choice>(active)

  useResetOnOpen(open, () => setSelected(active))

  const save = () => {
    if (selected === active) {
      onClose()
      return
    }
    // The account stores the language that will actually be used, plus whether
    // it was chosen — the server writes prose in the background and cannot ask a
    // device what language it is in.
    const applied = selected === 'device' ? deviceLocale() : selected
    update.mutate(
      { locale: applied, localeFollowsDevice: selected === 'device' },
      {
        onSuccess: () => {
          if (selected === 'device') followDevice()
          else setLocale(selected)
          // Read after the apply, so the confirmation is already in the new
          // language — the first proof that the switch took.
          toast.success(t('saved'))
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
      height={520}
      title={t('title')}
      footer={
        <Button variant="solid" className="w-full" disabled={update.isPending} onClick={save}>
          {update.isPending ? tCommon('saving') : t('save')}
        </Button>
      }
    >
      <p className="text-body-sm text-ink-muted">
        {t('eyebrow')}. {t('description')}
      </p>

      <SheetSection label={t('available')}>
        <div className="flex flex-col">
          {LOCALES.map((tag) => {
            const meta = LOCALE_META[tag]
            return (
              <LanguageOption
                key={tag}
                lang={tag}
                selected={selected === tag}
                onSelect={() => setSelected(tag)}
                endonym={meta.endonym}
                meta={meta.endonym === meta.englishName ? undefined : meta.englishName}
              />
            )
          })}
        </div>
      </SheetSection>

      <SheetSection label={t('systemDefault')}>
        <div className="flex flex-col">
          <LanguageOption
            lang={locale}
            selected={selected === 'device'}
            onSelect={() => setSelected('device')}
            endonym={t('onThisDevice')}
          />
        </div>
      </SheetSection>
    </Sheet>
  )
}
