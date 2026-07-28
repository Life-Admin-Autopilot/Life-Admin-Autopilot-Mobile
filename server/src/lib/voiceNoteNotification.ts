import { Notification } from '../models/Notification'
import type { VoiceNoteDoc } from '../models/VoiceNote'

// What the user is told once a voice note finishes processing.
//
// This replaces an Expo push relay that could never have worked: it POSTed to
// exp.host with an "Expo push token" that no client ever registered, in an app
// that is plain Capacitor, not Expo. It also wrote NOTHING to the in-app feed,
// so voice notes were the one pipeline whose completion never reached the bell
// — document scans have always written a row here.
//
// A Notification row is the durable record; delivery to the OS is the client's
// job via locally-scheduled notifications.

export function voiceNoteNotificationBody(note: VoiceNoteDoc): string {
  const captured = note.extractedTasks.length
  const askedAbout = note.clarifyItems.length

  // Every lane produces a real task now, so the count the user cares about is
  // simply how many things got filed — not how many are "waiting" on them.
  const filed = captured + askedAbout
  if (filed === 0) return 'Nothing to file from that one.'

  const head = filed === 1 ? '1 thing filed' : `${filed} things filed`
  if (askedAbout === 0) return head
  return `${head} · ${askedAbout === 1 ? '1 guess to confirm' : `${askedAbout} guesses to confirm`}`
}

export async function recordVoiceNoteNotification(note: VoiceNoteDoc): Promise<void> {
  await Notification.create({
    userId: note.userId,
    kind: 'reminder',
    title: 'Your voice note is ready',
    body: voiceNoteNotificationBody(note),
  })
}
