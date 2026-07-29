// The locale catalogue. Adding a language means adding an entry here, a
// messages/<tag>.json, and nothing else — every other module reads this list
// rather than hardcoding 'en' | 'ar'.
//
// Pure by default (AGENTS.md → module boundaries): no I/O, no framework
// runtime. The store that persists a choice lives in localeStore.ts.

/** BCP 47 tags the app ships. `DEFAULT_LOCALE` is the fallback for anything unknown. */
export const LOCALES = ['en', 'ar'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export type Direction = 'ltr' | 'rtl'

interface LocaleMeta {
  /** What the language calls itself — never translated. A language picker that
   *  renders "Arabic" to someone who only reads Arabic is useless. */
  readonly endonym: string
  /** English name, for logs and the a11y label on the picker row. */
  readonly englishName: string
  readonly dir: Direction
  /**
   * The tag handed to `Intl.*`. Arabic pins `-u-nu-latn` so dates, times and
   * counts render with Western digits (0-9) rather than Arabic-Indic (٠-٩).
   * Two reasons: the design system leans on `font-variant-numeric: tabular-nums`
   * for column alignment (StatTile, CompletionRing, DeadlineMeter) and
   * Arabic-Indic glyphs are not tabular in most faces, and modern Gulf/Levant
   * product UI overwhelmingly ships Western digits. Prose stays Arabic; only
   * the numerals are pinned.
   */
  readonly intlTag: string
}

export const LOCALE_META: Readonly<Record<Locale, LocaleMeta>> = {
  en: {
    endonym: 'English',
    englishName: 'English',
    dir: 'ltr',
    intlTag: 'en',
  },
  ar: {
    endonym: 'العربية',
    englishName: 'Arabic',
    dir: 'rtl',
    intlTag: 'ar-u-nu-latn',
  },
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function directionOf(locale: Locale): Direction {
  return LOCALE_META[locale].dir
}

export function intlTagOf(locale: Locale): string {
  return LOCALE_META[locale].intlTag
}

/**
 * Best supported locale for a BCP 47 tag from outside the app — a stored
 * `User.locale`, a `navigator.language`, an OS setting. Matches on the primary
 * subtag so `ar-EG`, `ar-SA` and `ar` all land on `ar`.
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE
  const primary = tag.toLowerCase().split(/[-_]/)[0]
  return isLocale(primary) ? primary : DEFAULT_LOCALE
}
