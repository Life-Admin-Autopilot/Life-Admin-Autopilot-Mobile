// Message catalogues, statically imported and composed per namespace.
//
// Both languages ship in the main bundle rather than lazy-loading per locale.
// That is the right trade here specifically because Kitto is a Capacitor app:
// the bundle is on the device, there is no network fetch to save, and an async
// catalogue would mean a flash of untranslated UI on every cold start.
//
// ONE FILE PER NAMESPACE, not one per locale. A single en.json heading for ~800
// keys is a file nobody can review and that every parallel change collides in —
// two people (or two agents) adding keys to different surfaces were editing the
// same lines. Split by namespace, a change to the scan copy touches
// messages/en/scan.json and messages/ar/scan.json and nothing else.
//
// Adding a namespace means adding both files and one line in each map below.
// scripts/check-i18n-catalogues.mjs walks the directories, so it needs no edit
// and will fail the build if the two locales drift apart.

import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'

import enChat from '@/lib/i18n/messages/en/chat.json'
import enCommon from '@/lib/i18n/messages/en/common.json'
import enDomain from '@/lib/i18n/messages/en/domain.json'
import enErrors from '@/lib/i18n/messages/en/errors.json'
import enLanguage from '@/lib/i18n/messages/en/language.json'
import enMatters from '@/lib/i18n/messages/en/matters.json'
import enMoney from '@/lib/i18n/messages/en/money.json'
import enNav from '@/lib/i18n/messages/en/nav.json'
import enNotifications from '@/lib/i18n/messages/en/notifications.json'
import enProfile from '@/lib/i18n/messages/en/profile.json'
import enVoice from '@/lib/i18n/messages/en/voice.json'
import enAuth from '@/lib/i18n/messages/en/auth.json'
import enDashboard from '@/lib/i18n/messages/en/dashboard.json'
import enLib from '@/lib/i18n/messages/en/lib.json'
import enOnboarding from '@/lib/i18n/messages/en/onboarding.json'
import enScan from '@/lib/i18n/messages/en/scan.json'
import enUi from '@/lib/i18n/messages/en/ui.json'
import enUncertainty from '@/lib/i18n/messages/en/uncertainty.json'

import arChat from '@/lib/i18n/messages/ar/chat.json'
import arCommon from '@/lib/i18n/messages/ar/common.json'
import arDomain from '@/lib/i18n/messages/ar/domain.json'
import arErrors from '@/lib/i18n/messages/ar/errors.json'
import arLanguage from '@/lib/i18n/messages/ar/language.json'
import arMatters from '@/lib/i18n/messages/ar/matters.json'
import arMoney from '@/lib/i18n/messages/ar/money.json'
import arNav from '@/lib/i18n/messages/ar/nav.json'
import arNotifications from '@/lib/i18n/messages/ar/notifications.json'
import arProfile from '@/lib/i18n/messages/ar/profile.json'
import arVoice from '@/lib/i18n/messages/ar/voice.json'
import arAuth from '@/lib/i18n/messages/ar/auth.json'
import arDashboard from '@/lib/i18n/messages/ar/dashboard.json'
import arLib from '@/lib/i18n/messages/ar/lib.json'
import arOnboarding from '@/lib/i18n/messages/ar/onboarding.json'
import arScan from '@/lib/i18n/messages/ar/scan.json'
import arUi from '@/lib/i18n/messages/ar/ui.json'
import arUncertainty from '@/lib/i18n/messages/ar/uncertainty.json'

const en = {
  common: enCommon,
  nav: enNav,
  errors: enErrors,
  notifications: enNotifications,
  language: enLanguage,
  chat: enChat,
  voice: enVoice,
  profile: enProfile,
  matters: enMatters,
  money: enMoney,
  domain: enDomain,
  auth: enAuth,
  dashboard: enDashboard,
  lib: enLib,
  onboarding: enOnboarding,
  scan: enScan,
  ui: enUi,
  uncertainty: enUncertainty,
}

/** The shape every catalogue must satisfy. English is the reference. */
export type Messages = typeof en

const ar: Messages = {
  common: arCommon,
  nav: arNav,
  // `as` rather than a plain annotation on each: a cast cannot catch a MISSING
  // key (TypeScript allows asserting a narrower object type to a wider one), so
  // the real guarantee comes from scripts/check-i18n-catalogues.mjs, not here.
  errors: arErrors as Messages['errors'],
  notifications: arNotifications,
  language: arLanguage,
  chat: arChat,
  voice: arVoice,
  profile: arProfile as Messages['profile'],
  matters: arMatters as Messages['matters'],
  money: arMoney as Messages['money'],
  domain: arDomain,
  auth: arAuth as Messages['auth'],
  dashboard: arDashboard as Messages['dashboard'],
  lib: arLib as Messages['lib'],
  onboarding: arOnboarding as Messages['onboarding'],
  scan: arScan as Messages['scan'],
  ui: arUi as Messages['ui'],
  uncertainty: arUncertainty as Messages['uncertainty'],
}

const CATALOGUES: Readonly<Record<Locale, Messages>> = { en, ar }

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE]
}
