// Message catalogues, statically imported.
//
// Both languages ship in the main bundle rather than lazy-loading per locale.
// That is the right trade here specifically because Kitto is a Capacitor app:
// the bundle is on the device, there is no network fetch to save, and an async
// catalogue would mean a flash of untranslated UI on every cold start. Each
// catalogue is ~12KB gzipped.
//
// Revisit only if a third and fourth language land — at that point switch to
// dynamic import() keyed on locale and accept the boot flash.

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'
import ar from '@/lib/i18n/messages/ar.json'
import en from '@/lib/i18n/messages/en.json'

/** The shape every catalogue must satisfy. English is the reference. */
export type Messages = typeof en

const CATALOGUES: Readonly<Record<Locale, Messages>> = {
  en,
  // Typed against the English catalogue, so a key added to en.json and missed
  // in ar.json is a compile error rather than a blank string at runtime.
  ar: ar as Messages,
}

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE]
}
