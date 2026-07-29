// The active locale. Zustand rather than React context for the same reason
// lib/tabBarStore.ts is: the language picker lives deep inside a profile sheet
// and the consumers (<html dir>, every screen, lib/i18n/format.ts) are its
// siblings, not its children.
//
// Precedence, highest first:
//   1. the signed-in user's `User.locale` (reconciled by useSyncUserLocale)
//   2. a previous choice in localStorage — read synchronously so a reload
//      paints Arabic immediately instead of flashing English
//   3. the device language (`navigator.languages`)
//   4. DEFAULT_LOCALE
//
// Seam module (AGENTS.md → module boundaries): touches localStorage and the
// document, so it sits alongside lib/auth/sessionStore.ts rather than under the
// pure-by-default rule.

import { create } from 'zustand'

import {
  DEFAULT_LOCALE,
  type Direction,
  type Locale,
  directionOf,
  intlTagOf,
  resolveLocale,
} from '@/lib/i18n/locales'

/** Shared with the pre-paint script in app/layout.tsx — keep the two in step. */
export const LOCALE_STORAGE_KEY = 'kitto.locale'

interface LocaleState {
  locale: Locale
  /** Applies immediately and persists. Backend sync is the caller's job. */
  setLocale: (locale: Locale) => void
}

// localStorage is absent during the static-export prerender and can throw in
// Capacitor's file:// context when storage is disabled — fail soft both ways.
function readStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return raw ? resolveLocale(raw) : null
  } catch {
    return null
  }
}

function writeStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* quota / disabled storage — the choice just won't survive a reload */
  }
}

function readDeviceLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of tags) {
    const resolved = resolveLocale(tag)
    // resolveLocale falls back to DEFAULT_LOCALE for anything unsupported, so
    // only treat it as a device match when the tag genuinely named that locale.
    if (tag && resolved !== DEFAULT_LOCALE) return resolved
    if (tag?.toLowerCase().startsWith(DEFAULT_LOCALE)) return DEFAULT_LOCALE
  }
  return null
}

/**
 * Resolved once at module load. On the server this is DEFAULT_LOCALE; the
 * pre-paint script in the document head has already set <html> to the real
 * value by the time React hydrates, and useApplyDocumentLocale re-asserts it.
 */
function initialLocale(): Locale {
  return readStoredLocale() ?? readDeviceLocale() ?? DEFAULT_LOCALE
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    writeStoredLocale(locale)
    applyDocumentLocale(locale)
    set({ locale })
  },
}))

/** Selector — returns a primitive, so no useShallow needed. */
export const useLocale = (): Locale => useLocaleStore((s) => s.locale)

export const useDirection = (): Direction => useLocaleStore((s) => directionOf(s.locale))

/**
 * The tag to hand `Intl.*` — `ar-u-nu-latn`, not `ar`. Every component that
 * formats a date, time or number reads this rather than the bare locale, and
 * subscribing here is also what re-renders a row when the language changes.
 */
export const useIntlTag = (): string => useLocaleStore((s) => intlTagOf(s.locale))

export const useSetLocale = (): ((locale: Locale) => void) =>
  useLocaleStore((s) => s.setLocale)

/** Non-hook read, for modules outside the React tree (lib/toast.ts, notifications). */
export function currentLocale(): Locale {
  return useLocaleStore.getState().locale
}

/**
 * Mirrors the locale onto <html lang dir>. Called by setLocale and by the
 * provider on mount — the pre-paint script sets these first, this keeps them
 * true afterwards.
 */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.lang = locale
  el.dir = directionOf(locale)
}

/**
 * Adopts the locale stored on the signed-in account. Called once the profile
 * resolves, so a user who set Arabic on another device gets Arabic here without
 * touching settings again. A no-op when the account has no locale yet, so it
 * never overwrites a fresh local choice with a stale server value.
 */
export function adoptUserLocale(tag: string | null | undefined): void {
  if (!tag) return
  const resolved = resolveLocale(tag)
  if (resolved === useLocaleStore.getState().locale) return
  useLocaleStore.getState().setLocale(resolved)
}
