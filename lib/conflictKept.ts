// "Keep it anyway" — settling the QUESTION, never the clash.
//
// The distinction is the whole file, and getting it wrong cost a round of
// confusing behaviour. Two different things were being conflated:
//
//   - the CLASH: two saved matters whose times overlap. A fact. It is true
//     until one of them moves, it is listed wherever conflicts are listed, and
//     nothing dismisses it — the same way a calendar never offers to dismiss a
//     double-booking. See components/conflicts/ConflictsSheet.tsx.
//
//   - the QUESTION: "this clashes — change it or keep it?", raised once by the
//     voice worker as a Clarification, or once by the chat agent as a card in
//     the transcript. That IS answerable, and "keep it" is a real answer.
//
// This module answers the question. It does not, and must not, hide the clash:
// when the ledger filtered on it, keeping every clash emptied the conflicts
// sheet while the dashboard went on counting all of them, and the user had no
// way to tell which screen was lying.
//
// A SEAM, not a pure module (AGENTS.md → Module boundaries): it touches
// localStorage and the API, which is the point rather than an accident.
//
// The local half is per-device, and that is fine HERE in a way it would not be
// for a clash: all it suppresses is one card re-raising itself when an old chat
// transcript is scrolled back through. That is the same cosmetic job a
// dismissed banner uses localStorage for. The durable half — dropping the
// Clarification — is server-side and works everywhere.

import { api } from '@/lib/api/client'
import { logger } from '@/lib/logger'

const KEY = 'kitto:conflict_kept'

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    // A private-mode window, a quota error, or a value some other build wrote.
    // None is worth failing a render over: unreadable means "nothing answered",
    // which at worst re-offers a card the user already dealt with.
    return []
  }
}

/** Has this matter's clash card already been answered on this device? */
export function isConflictKept(taskId: string): boolean {
  return read().includes(taskId)
}

/**
 * Answer the question with "keep it".
 *
 * `clarificationId` is present only when something actually asked — a voice note
 * holds its question as a Clarification, while a clash the user met in chat or
 * in the create sheet never raised one. Passing it settles the question for
 * good, so the matter stops appearing in the uncertainty stack.
 *
 * Fire-and-forget on the network half: the local record is what the card reads,
 * so a failed drop must not stop it collapsing. It is logged, and the stack
 * would re-ask at worst.
 */
export function keepConflict(taskId: string, clarificationId?: string): void {
  try {
    const current = read()
    if (!current.includes(taskId)) {
      window.localStorage.setItem(KEY, JSON.stringify([...current, taskId]))
    }
  } catch (err: unknown) {
    logger.warn('conflict:keep-store-failed', { taskId, err })
  }

  if (!clarificationId) return

  void api(`/me/clarifications/${clarificationId}/drop`, { method: 'POST' }).catch(
    (err: unknown) => logger.warn('conflict:keep-drop-failed', { clarificationId, err }),
  )
}
