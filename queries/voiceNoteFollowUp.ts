// What happens after the island closes.
//
// Voice is fire-and-forget: Save uploads and the surface goes away, so the ONLY
// thing that can tell the user what became of their note is this — a background
// poll that runs on the app shell, not on the closed surface. It watches one
// note until the server is finished with it, refreshes every cache the worker
// could have written to, and states the outcome once.
//
// It is a poll rather than a `useQuery` with `refetchInterval` because the
// lifetime is wrong for a cache entry: the watch outlives the component that
// started it conceptually (the island closes immediately), has a hard deadline,
// and produces a one-shot side effect rather than rendered state. A query key
// would also make two overlapping notes fight over one entry.
//
// Giving up is not a failure. The notification feed polls on its own minute
// timer (queries/notifications.ts) and the worker writes a completion
// notification, so a note that is still working after three minutes surfaces
// there. This is the fast path, not the only path.

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { api, ApiError } from '@/lib/api/client'
import type { Translate } from '@/lib/i18n/translate'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { queryKeys } from '@/queries/keys'
import { isTerminalVoiceNoteStatus, voiceNotePath, type VoiceNote, type VoiceNoteResponse } from '@/queries/voiceNotes'

/**
 * Backoff schedule, in ms, indexed by attempt; the last entry repeats. Tight at
 * the start because a short note about one matter is usually done inside ten
 * seconds, and slack afterwards because a long one is bounded by an ASR call we
 * cannot hurry.
 */
const POLL_DELAYS_MS = [2_000, 2_000, 2_000, 3_000, 5_000] as const

/** After this, the feed takes over. */
const POLL_GIVE_UP_MS = 3 * 60 * 1000

/** Exactly the keys the outcome sentence asks for — see lib/i18n/translate.ts. */
type OutcomeTranslate = Translate<
  'workerFailed' | 'nothingCaptured' | 'outcomeFiled' | 'outcomeNeedsInput' | 'outcomeNeedsInputUnknown'
>

/**
 * Everything the worker could have touched.
 *
 * `tasks.all` and `digestAll` are the blunt handles on purpose — a filed matter
 * changes the list, the counts and today's briefing, and a caller here has no
 * idea which filters or which timezone are currently cached.
 */
function invalidateAfterVoiceNote(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all })
  void queryClient.invalidateQueries({ queryKey: queryKeys.digestAll })
  void queryClient.invalidateQueries({ queryKey: queryKeys.clarifications })
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications })
  void queryClient.invalidateQueries({ queryKey: queryKeys.briefing() })
}

/**
 * The one sentence the user gets.
 *
 * `reviewItems` is not the whole story: an uncertainty the worker turned into a
 * Clarification never appears on the note (the clarify lane is stripped from the
 * wire shape), so a note can arrive `needs_review` with nothing in the array.
 * The status is therefore the authority on "something needs you", and the count
 * is an enrichment when we happen to have it.
 */
function announceOutcome(note: VoiceNote, t: OutcomeTranslate): void {
  if (note.status === 'failed') {
    toast.error(t('workerFailed'))
    return
  }

  const filed = note.extractedTasks.length
  const held = note.reviewItems.length
  const needsInput = held > 0 || note.status === 'needs_review'

  if (filed === 0 && !needsInput) {
    toast.info(t('nothingCaptured'))
    return
  }

  const title = t('outcomeFiled', { count: filed })
  const description = needsInput
    ? held > 0
      ? t('outcomeNeedsInput', { count: held })
      : t('outcomeNeedsInputUnknown')
    : undefined

  if (needsInput) {
    toast.info(title, { description })
  } else {
    toast.success(title)
  }
}

/**
 * Start watching a voice note. Safe to call once per accepted upload.
 *
 * The returned function is stable, so the island can call it from a submit
 * handler without it becoming a dependency that re-runs anything.
 */
export function useVoiceNoteFollowUp(): (noteId: string) => void {
  const queryClient = useQueryClient()
  const t = useTranslations('voice')

  // The watch outlives the render that started it, so both of these are read
  // through refs: `t` so a language change mid-flight still speaks the current
  // language, `alive` so an unmount stops the loop instead of toasting into a
  // torn-down tree.
  const translateRef = useRef(t)
  useEffect(() => {
    translateRef.current = t
  }, [t])

  const aliveRef = useRef(true)
  const timersRef = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const timers = timersRef.current
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      timers.forEach(clearTimeout)
      timers.clear()
    }
  }, [])

  return useCallback(
    (noteId: string) => {
      const startedAt = Date.now()
      let attempt = 0

      const schedule = () => {
        if (!aliveRef.current) return
        if (Date.now() - startedAt > POLL_GIVE_UP_MS) {
          // Not an error and not silent: the worker may well have filed
          // everything already, so refresh, and let the feed carry the rest.
          logger.warn('voiceNote:follow-up-gave-up', { noteId })
          invalidateAfterVoiceNote(queryClient)
          return
        }
        const delay = POLL_DELAYS_MS[Math.min(attempt, POLL_DELAYS_MS.length - 1)]
        attempt += 1
        const timer = setTimeout(() => {
          timersRef.current.delete(timer)
          void poll()
        }, delay)
        timersRef.current.add(timer)
      }

      const poll = async () => {
        if (!aliveRef.current) return
        try {
          const res = await api<VoiceNoteResponse>(voiceNotePath(noteId))
          const note = res.voiceNote
          if (!isTerminalVoiceNoteStatus(note.status)) {
            schedule()
            return
          }
          if (!aliveRef.current) return
          invalidateAfterVoiceNote(queryClient)
          announceOutcome(note, translateRef.current)
        } catch (err) {
          // A note that no longer exists will never reach a terminal status, so
          // the only thing left to do is stop. Everything else — a dropped
          // connection, a 500 — is transient by assumption, and the deadline in
          // `schedule` is what stops it running forever.
          if (err instanceof ApiError && err.status === 404) {
            logger.warn('voiceNote:follow-up-note-missing', { noteId })
            return
          }
          logger.warn('voiceNote:follow-up-poll-failed', { noteId, err })
          schedule()
        }
      }

      schedule()
    },
    [queryClient],
  )
}
