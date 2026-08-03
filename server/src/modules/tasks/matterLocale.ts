// Presenting a matter in the reader's language.
//
// The split this module enforces: `title`/`notes`/`subtasks[].text` on the Task
// are CANONICAL and never rewritten by a translation. `i18n[locale]` holds
// read-only presentation copies. Everything that reasons about a matter keeps
// reading canonical — which is not a simplification, it is the point:
//
//   - taskQuery's `$or: [{title: rx}, {notes: rx}]` searches one field set, so a
//     matter can never match twice.
//   - semanticSearch dedups on task id; translations as separate rows would have
//     doubled its pool and halved its effective 300-matter cap.
//   - reminders/leadTime.ts picks a lead time (180 days down to 1) by running
//     eight English keyword regexes over the title. An Arabic-only title matches
//     none and silently falls back to the domain default, so keeping the English
//     original is what stops a passport renewal losing its six-month warning.
//
// So the overlay happens at the boundary, on the way out to the client, and
// nowhere else.

import type { AiLocale } from '../ai/promptLanguage'
import { resolveAiLocale, DEFAULT_AI_LOCALE } from '../ai/promptLanguage'

/** Arabic, Arabic Supplement, Extended-A/B, and the presentation forms. */
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࡰ-࢏ࢠ-ࣿﭐ-﷿ﹰ-﻿]/

/**
 * Which language a matter's existing text is written in, inferred from the
 * script. Used to backfill `sourceLocale` on rows created before the field
 * existed — every row written since stamps it at creation.
 *
 * Script detection rather than a model call because it is free, instant, and
 * for the two languages this app ships it is exact: Arabic and English share no
 * letters. It would need replacing the day a second Latin-script language lands,
 * and `resolveAiLocale` is where that decision would go.
 */
export function detectSourceLocale(...text: (string | undefined | null)[]): AiLocale {
  return text.some((value) => value && ARABIC_SCRIPT.test(value)) ? 'ar' : DEFAULT_AI_LOCALE
}

interface TranslatableMatter {
  title?: string
  notes?: string
  subtasks?: { _id?: unknown; text?: string }[]
  sourceLocale?: string
  i18n?: Record<string, { title?: string; notes?: string; subtasks?: Record<string, string> }>
}

/**
 * Overlays the reader's language onto one matter, in place on a plain object.
 * A no-op when the matter is already in that language or has no copy for it,
 * which is the common case and must stay cheap — this runs per row on every
 * list read.
 *
 * `i18n` is stripped from the result either way. The client renders one language
 * at a time and shipping every translation on every row would grow the list
 * payload without any screen using it.
 */
export function presentMatter<T extends TranslatableMatter>(matter: T, locale: AiLocale): T {
  const { i18n, ...rest } = matter
  const source = resolveAiLocale(matter.sourceLocale)
  if (source === locale || !i18n) return rest as T

  const copy = i18n[locale]
  if (!copy) return rest as T

  const presented = rest as T
  if (copy.title) presented.title = copy.title
  if (copy.notes) presented.notes = copy.notes

  if (copy.subtasks && Array.isArray(presented.subtasks)) {
    presented.subtasks = presented.subtasks.map((sub) => {
      const translated = copy.subtasks?.[String(sub._id)]
      return translated ? { ...sub, text: translated } : sub
    })
  }

  return presented
}

export function presentMatters<T extends TranslatableMatter>(matters: T[], locale: AiLocale): T[] {
  return matters.map((matter) => presentMatter(matter, locale))
}
