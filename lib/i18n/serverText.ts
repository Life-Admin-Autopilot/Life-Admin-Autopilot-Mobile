// Renders a string the SERVER composed, in the reader's language.
//
// Most user-facing text either comes from the model — already in the language of
// the message it answers — or is written here as an i18n key. Voice clarification
// questions are neither. `VoiceAutoFilePolicy` composes them server-side, because
// voice is fire-and-forget and the AI never asks during the interaction, and
// composed there they were composed in English: an Arabic note produced
// "What time on Sunday 23 August?" sitting inside Arabic chrome.
//
// So those rows now carry a KEY beside the English sentence. This turns the key
// back into text.
//
// WHY THE SERVER SENDS AN INSTANT AND NOT A FORMATTED DAY. `params.at` is a UTC
// ISO string, and the day and clock time are derived from it HERE. The server
// formatting them would bake in its own locale and a 24-hour clock, which is how
// the English fallback reads; going through the same formatters as every other
// date on screen is what makes a chip say ٩:٠٠ ص next to an Arabic question and
// 9:00 AM next to an English one.
//
// FALLING BACK IS NORMAL, NOT AN ERROR. Chat questions have no key at all — the
// model wrote them — and neither does any row raised before this shipped. Both
// render their stored string unchanged.

import { formatDayMonth, formatTime, formatWeekday } from '@/lib/i18n/dateFormat'
import type { Translate } from '@/lib/i18n/translate'

/** The keys this module asks the `uncertainty` catalogue for. */
export type ServerTextKey =
  | 'ask.whatTimeOn'
  | 'ask.closeTo'
  | 'ask.alreadyHave'
  | 'ask.didYouMean'
  | 'ask.whenDue'
  | 'ask.howMuch'
  | 'chip.at'
  | 'chip.morning'
  | 'chip.afternoon'
  | 'chip.evening'
  | 'chip.keepThisTime'
  | 'chip.laterThatDay'
  | 'chip.dayAt'
  | 'chip.keepBoth'
  | 'chip.yesThatIsRight'
  | 'chip.noDateNeeded'
  | 'chip.tomorrowAt'

const KEYS = new Set<string>([
  'ask.whatTimeOn',
  'ask.closeTo',
  'ask.alreadyHave',
  'ask.didYouMean',
  'ask.whenDue',
  'ask.howMuch',
  'chip.at',
  'chip.morning',
  'chip.afternoon',
  'chip.evening',
  'chip.keepThisTime',
  'chip.laterThatDay',
  'chip.dayAt',
  'chip.keepBoth',
  'chip.yesThatIsRight',
  'chip.noDateNeeded',
  'chip.tomorrowAt',
])

/**
 * The stored English, or the key rendered in the reader's language when there is
 * one and it is a key this build knows.
 *
 * The membership check is what keeps a newer server from blanking the card: an
 * unrecognised key would otherwise reach next-intl, which renders a missing key
 * as the key itself — "ask.somethingNew" on screen, where a perfectly readable
 * English sentence was sitting in `fallback` the whole time.
 */
export function serverText(
  fallback: string,
  key: string | undefined,
  params: Record<string, string> | undefined,
  t: Translate<ServerTextKey>,
  tag: string,
): string {
  if (!key || !KEYS.has(key)) return fallback

  return t(key as ServerTextKey, expand(params, tag))
}

/**
 * `at` becomes `day` and `time`; everything else passes through.
 *
 * An `at` that will not parse is dropped rather than substituted, so the message
 * renders with an empty slot instead of "Invalid Date".
 */
function expand(
  params: Record<string, string> | undefined,
  tag: string,
): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [name, value] of Object.entries(params ?? {})) {
    if (name !== 'at') {
      out[name] = value
      continue
    }

    const instant = new Date(value)
    if (Number.isNaN(instant.getTime())) continue

    out.time = formatTime(instant, tag)
    out.day = `${formatWeekday(instant, tag)} ${formatDayMonth(instant, tag)}`
  }

  return out
}
