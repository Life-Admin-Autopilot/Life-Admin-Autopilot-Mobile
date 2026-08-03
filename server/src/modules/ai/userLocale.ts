// Resolves the language a given user's generated text must come back in.
//
// Read from the account rather than taken from the request, even on the
// interactive path where the client could just send it. Two reasons: the
// background writers (daily digest, document extraction, voice-note extraction)
// have no request to read, and one code path that is right everywhere beats two
// that disagree the day a client forgets to send the field. The cost is a
// single-field findById next to a Gemini call.

import { User } from '../../models/User'
import { logger } from '../../logger'
import { DEFAULT_AI_LOCALE, resolveAiLocale, type AiLocale } from './promptLanguage'

export async function getUserAiLocale(userId: string): Promise<AiLocale> {
  try {
    const user = await User.findById(userId).select('locale').lean()
    return resolveAiLocale(user?.locale)
  } catch (err: unknown) {
    // A generation that answers in the wrong language beats one that does not
    // answer, so this degrades to English rather than propagating.
    logger.warn({ err, userId }, 'ai:locale-read-failed')
    return DEFAULT_AI_LOCALE
  }
}
