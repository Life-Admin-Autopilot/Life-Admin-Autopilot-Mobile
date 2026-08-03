// The language every generated string comes back in.
//
// The setting behind this tells the user it "changes the whole app, including
// what Kitto writes back", so their locale — not the language they happened to
// type in, and not the language of the document they photographed — decides.
// Both directions matter: an Arabic user who types one English word still gets
// Arabic back, and an Arabic user scanning an English bill gets an Arabic
// sentence about it.
//
// Pure: string building only. The DB read that resolves a user's locale is in
// userLocale.ts, and the catalogue is deliberately duplicated from the app's
// lib/i18n/locales.ts because the server is a separate package with no import
// path into it. Adding a language means touching both.

export const AI_LOCALES = ['en', 'ar'] as const

export type AiLocale = (typeof AI_LOCALES)[number]

export const DEFAULT_AI_LOCALE: AiLocale = 'en'

/** How the rule names the language to the model. */
const LANGUAGE_NAME: Readonly<Record<AiLocale, string>> = {
  en: 'English',
  ar: 'Arabic (العربية)',
}

export function isAiLocale(value: unknown): value is AiLocale {
  return typeof value === 'string' && (AI_LOCALES as readonly string[]).includes(value)
}

/**
 * Best supported locale for a stored BCP 47 tag. Matches the primary subtag so
 * `ar-EG`, `ar-SA` and `ar` all land on `ar`, and anything unknown (or absent,
 * on an account that predates the picker) falls back to English.
 */
export function resolveAiLocale(tag: string | null | undefined): AiLocale {
  if (!tag) return DEFAULT_AI_LOCALE
  const primary = tag.toLowerCase().split(/[-_]/)[0]
  return isAiLocale(primary) ? primary : DEFAULT_AI_LOCALE
}

export function languageName(locale: AiLocale): string {
  return LANGUAGE_NAME[locale]
}

// Applies to every rule below, and exported for prompts that need to say
// something more specific than "all of it" about which fields are prose —
// categorisation, where `domain` is a keyword and tags belong to the user's own
// vocabulary. A payee, a policy number or an amount is not prose: it is the
// thing the user will match against the letter in their hand, and a translated
// one is worse than useless because it still looks right.
export function languagePreserveRules(locale: AiLocale): string {
  return [verbatimClause(), numeralClause(locale)]
    .filter((line): line is string => line !== null)
    .join('\n')
}

function verbatimClause(): string {
  return [
    'NEVER translate or transliterate these, wherever they fall — mid-sentence included:',
    '- names of people, companies, institutions, places and products',
    '- account, policy, reference, invoice and licence numbers',
    '- amounts, currency codes and units',
    '- email addresses, URLs, phone numbers',
    'Copy them exactly as they appear, in their original script. A translated payee',
    'is one the user cannot find on their bill.',
  ].join('\n')
}

// Arabic-Indic digits would be correct Arabic and wrong here: the app pins
// `-u-nu-latn` on every Intl call so dates and counts stay Western, partly
// because the design system leans on tabular-nums for column alignment. Prose
// that disagreed with the numbers beside it would read as a rendering bug.
function numeralClause(locale: AiLocale): string | null {
  if (locale !== 'ar') return null
  return 'Write numerals as Western digits (0-9), never Arabic-Indic (٠-٩) — the rest of the app is pinned that way.'
}

function rule(locale: AiLocale, opening: string[]): string {
  return ['LANGUAGE — ABSOLUTE', ...opening, languagePreserveRules(locale)].join('\n')
}

/**
 * For anything that talks to the user: the assistant's replies, clarifying
 * questions, digest headlines, summaries, categorisation reasons.
 */
export function conversationLanguageRule(locale: AiLocale): string {
  return rule(locale, [
    `Write every word the user will read in ${languageName(locale)}. Replies, titles,`,
    'notes, questions, suggested answers, headlines, reasons — all of it.',
    'This is a language they chose in Settings, so it holds even when they write to',
    `you in a different one: answer in ${languageName(locale)} regardless.`,
  ])
}

/**
 * For translating text that already exists, which is a different job from
 * authoring it: nothing may be added, dropped, or improved. A translator that
 * "tidies" a matter changes what the user wrote down, and they will not know it
 * happened until the English they typed comes back different.
 */
export function translationLanguageRule(locale: AiLocale): string {
  return rule(locale, [
    `Translate the text you are given into ${languageName(locale)}.`,
    'This is a translation, not a rewrite. Do not add information, do not drop',
    'information, do not shorten, do not improve the phrasing, do not correct what',
    'looks like a mistake. If a line is already in the target language, return it',
    'unchanged.',
  ])
}

/**
 * For extraction, where the source is whatever language it happens to be in.
 * Splits the difference the conversation rule does not have to: the facts are
 * copied, the prose about them is written.
 */
export function extractionLanguageRule(locale: AiLocale): string {
  return rule(locale, [
    `The source may be in any language. What you WRITE is in ${languageName(locale)}:`,
    'the title, the notes, the reasons, any question you ask. Do NOT mirror the',
    "source's language — the user reads this inside an app that is in",
    `${languageName(locale)}.`,
  ])
}
