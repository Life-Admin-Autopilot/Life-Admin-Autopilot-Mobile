// Which questions have already had their pop-up.
//
// The voice follow-up finds its panels by reading the notification rows written
// since the watch began, with a minute of slack for clock skew between the
// server's stamp and the client's clock. That slack is what makes a SECOND
// recording re-announce the FIRST one's question: record twice inside a minute
// and the older row is still inside the newer watch's window, so the same panel
// appears again for a question the user has already been shown.
//
// Widening the window is not the fix — the row genuinely is recent, and the real
// rule is "announce a question ONCE", which is about the question rather than
// about time. So the ids are remembered.
//
// A SEAM, not a pure module: it reads and writes localStorage.
//
// Deliberately NOT a way of answering anything. A question that was announced and
// ignored stays open, keeps its place in the bell and in the uncertainty stack,
// and settles on its own after the server's seven-day window. All this decides is
// whether to interrupt the user about it a second time.

import { logger } from '@/lib/logger'

const KEY = 'kitto:announced_questions'

/**
 * How many ids to keep.
 *
 * Only recent ones can be re-announced at all — the follow-up's own window is a
 * couple of minutes wide — so this exists to stop the list growing without end,
 * not to bound correctness. Fifty is far more than a single session can raise.
 */
const KEEP = 50

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    // A private-mode window, a quota error, or a value some other build wrote.
    // Unreadable means "nothing announced", whose worst case is one repeated
    // pop-up — the thing this file reduces, never something the user loses.
    return []
  }
}

/** Has this question already been put in front of the user? */
export function wasAnnounced(clarificationId: string): boolean {
  return read().includes(clarificationId)
}

/** Remember that it has, keeping only the most recent ids. */
export function markAnnounced(clarificationId: string): void {
  try {
    const next = [...read().filter((id) => id !== clarificationId), clarificationId].slice(-KEEP)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch (err: unknown) {
    logger.warn('question:announce-store-failed', { clarificationId, err })
  }
}
