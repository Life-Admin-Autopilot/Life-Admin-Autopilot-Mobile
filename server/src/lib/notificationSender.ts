import { logger } from '../logger'
import { User } from '../models/User'
import type { VoiceNoteDoc } from '../models/VoiceNote'

// Surfaces a processed voice note via Expo push.
//
// Free-tier reality: delivers on Android + the dev client. iOS REMOTE push
// needs the paid Apple Developer Program (declined) — there it simply won't
// deliver, and the in-app CaptureStatusBanner is the reliable surface instead.
// Best-effort: never throws into the worker.
//
// Product rule (always-notify): 'needs_review' -> "N need a look",
// 'ready' (all-confident) -> "N captured", plus held questions -> "N need your
// call". Mixed notes combine the lanes ("2 saved · 1 needs your call").

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

function bodyFor(note: VoiceNoteDoc): string {
  const captured = note.extractedTasks.length
  const review = note.reviewItems.length
  const clarify = note.clarifyItems.length

  // More than one lane present → a compact combined summary.
  const lanes = [captured > 0, review > 0, clarify > 0].filter(Boolean).length
  if (lanes > 1) {
    const parts: string[] = []
    if (captured > 0) parts.push(`${captured} saved`)
    if (clarify > 0) parts.push(clarify === 1 ? '1 needs your call' : `${clarify} need your call`)
    if (review > 0) parts.push(review === 1 ? '1 to review' : `${review} to review`)
    return parts.join(' · ')
  }

  // Single lane → keep the warmer full phrasings.
  if (clarify > 0) {
    return clarify === 1 ? '1 thing needs your call' : `${clarify} things need your call`
  }
  if (review > 0) {
    return review === 1 ? '1 thing needs a quick look' : `${review} things need a quick look`
  }
  return captured === 1 ? '1 task captured from your note' : `${captured} tasks captured from your note`
}

export async function sendVoiceNoteNotification(note: VoiceNoteDoc): Promise<void> {
  if (note.status !== 'needs_review' && note.status !== 'ready') return

  const user = await User.findById(note.userId).select('deviceTokens notifications')
  if (!user) return
  if (user.notifications?.push === false) return // user opted out

  const tokens = (user.deviceTokens ?? []).map((d) => d.token).filter(Boolean)
  if (tokens.length === 0) return

  const messages = tokens.map((to) => ({
    to,
    title: 'Life Admin',
    body: bodyFor(note),
    data: { kind: 'voice_review', voiceNoteId: note.id },
    sound: 'default' as const,
  }))

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    })
    if (!res.ok) {
      logger.warn({ status: res.status, noteId: note.id }, 'push:send-non-200')
    }
  } catch (err: unknown) {
    logger.warn({ err, noteId: note.id }, 'push:send-failed')
  }
}
