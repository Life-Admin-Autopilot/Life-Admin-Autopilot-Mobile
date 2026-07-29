// Types next-intl against the English catalogue, so `t('matters.emptyTitle')`
// is checked at compile time and a typo — or a key added to en.json and
// forgotten in ar.json — fails `npm run typecheck` instead of rendering the raw
// key path to a user. This is what makes the ~600-string extraction safe to do
// mechanically.

import type en from '@/lib/i18n/messages/en.json'

declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof en
  }
}

// `AppConfig.Locale` is deliberately NOT augmented. Doing so would type the
// provider's `locale` prop as 'en' | 'ar' and reject the Intl extension tag
// `ar-u-nu-latn` we hand it — and that tag is load-bearing: it is what makes
// the `#` placeholder inside an ICU plural render as "3 أمور" rather than
// "٣ أمور". Locale type-safety comes from lib/i18n/locales.ts instead, which
// every app module uses; next-intl only needs the message shape.
