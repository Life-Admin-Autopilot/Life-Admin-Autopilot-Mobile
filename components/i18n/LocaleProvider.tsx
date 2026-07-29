'use client'

import { NextIntlClientProvider } from 'next-intl'
import { useEffect, useMemo } from 'react'

import { applyDocumentLocale, useLocale } from '@/lib/i18n/localeStore'
import { intlTagOf } from '@/lib/i18n/locales'
import { messagesFor } from '@/lib/i18n/messages'

interface LocaleProviderProps {
  children: React.ReactNode
}

/**
 * Hosts next-intl for the whole app.
 *
 * Client-only on purpose: Kitto is a static export (`output: 'export'`) bundled
 * into Capacitor, so there is no server to negotiate a locale and no middleware
 * to run. Locale is a user setting read from the store, never a URL segment —
 * which also means routes stay unprefixed and nothing under app/ is duplicated
 * per language.
 *
 * `locale` is passed as the Intl tag (ar-u-nu-latn), not the bare tag, so
 * next-intl's own number/date formatters agree with lib/i18n/format.ts about
 * Western digits.
 */
export function LocaleProvider({ children }: LocaleProviderProps) {
  const locale = useLocale()
  const messages = useMemo(() => messagesFor(locale), [locale])
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  // The pre-paint script in app/layout.tsx sets <html lang dir> before React
  // exists. This re-asserts it after hydration — needed because the prerendered
  // markup carries the build-time default, and because a locale adopted from
  // the signed-in account arrives later than first paint.
  useEffect(() => {
    applyDocumentLocale(locale)
  }, [locale])

  return (
    <NextIntlClientProvider
      locale={intlTagOf(locale)}
      messages={messages}
      timeZone={timeZone}
    >
      {children}
    </NextIntlClientProvider>
  )
}
