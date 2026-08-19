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
import { useRouter } from 'next/navigation'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import { api, ApiError } from '@/lib/api/client'
import type { Translate } from '@/lib/i18n/translate'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { queryKeys } from '@/queries/keys'
import type { AppNotification } from '@/queries/notifications'
import { previewConflicts } from '@/queries/planning'
import {
  isTerminalVoiceNoteStatus,
  retryVoiceNote,
  voiceNotePath,
  type VoiceNote,
  type VoiceNoteResponse,
} from '@/queries/voiceNotes'

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
  | 'workerFailed'
  | 'retry'
  | 'review'
  | 'changeIt'
  | 'keepAnyway'
  | 'answerNow'
  | 'later'
  | 'retryQueued'
  | 'retryUnavailable'
  | 'retryFailed'
  | 'nothingCaptured'
  | 'outcomeFiled'
  | 'outcomeNeedsInput'
  | 'outcomeNeedsInputUnknown'
>

/**
 * The decisions this note raised, one square panel each.
 *
 * The worker wrote one `uncertainty` notification per question, carrying the
 * question, the matter's name and BOTH ids — so the rows written since this
 * watch began ARE the pop-up's content, and tapping the panel or tapping the
 * bell row later land in exactly the same places. Whether a question is a
 * CLASH ("change it / keep it") or a plain gap ("answer / later") is decided
 * by checking the matter's time live, not by parsing the question's wording —
 * the question is in the user's language and wording is nobody's contract.
 *
 * Returns how many panels it raised; zero means the caller should fall back to
 * the plain needs-input toast rather than saying nothing.
 */
async function announceDecisions(
  since: number,
  t: OutcomeTranslate,
  onOpenMatter: (taskId: string) => void,
  onOpenStack: () => void,
): Promise<number> {
  const res = await api<{ notifications: AppNotification[] }>('/me/notifications')
  const rows = (res.notifications ?? [])
    .filter(
      (n) =>
        n.kind === 'uncertainty' &&
        n.taskId &&
        n.clarificationId &&
        // A minute of slack: the row is stamped server-side and the watch
        // started client-side, and losing a real question to clock skew is
        // worse than very occasionally re-raising a recent one.
        new Date(n.createdAt).getTime() >= since - 60_000,
    )
    // Two at most. A note that raised five questions is a stack problem, and
    // the stack is one tap away on any of these panels.
    .slice(0, 2)

  for (const row of rows) {
    const taskId = row.taskId!
    const clarificationId = row.clarificationId!
    // Sparse body: check the matter exactly as it stands now.
    const found = await previewConflicts(taskId, {})
    const clashing = found.conflicts.length > 0

    if (clashing) {
      toast.decide({
        tone: 'clash',
        title: row.title,
        description: `${row.body ?? ''} — ${found.conflicts[0].reason}`.replace(/^ — /, ''),
        primary: { label: t('changeIt'), onPress: () => onOpenMatter(taskId) },
        secondary: {
          label: t('keepAnyway'),
          // Keeping IS the answer: the matter already holds the time, so the
          // only thing left to clear is the open question about it.
          onPress: () => {
            void api(`/me/clarifications/${clarificationId}/drop`, { method: 'POST' }).catch(
              (err: unknown) => logger.warn('voiceNote:keep-anyway-drop-failed', { err }),
            )
          },
        },
      })
    } else {
      toast.decide({
        tone: 'question',
        title: row.title,
        description: row.body,
        primary: { label: t('answerNow'), onPress: onOpenStack },
        secondary: { label: t('later'), onPress: () => {} },
      })
    }
  }

  return rows.length
}

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
async function announceOutcome(
  note: VoiceNote,
  since: number,
  t: OutcomeTranslate,
  onRetry: (noteId: string) => void,
  onOpenMatter: (taskId: string) => void,
  onReview: () => void,
): Promise<void> {
  if (note.status === 'failed') {
    // The server's own words, when it has any.
    //
    // `failureReason` is written for a person and deliberately SURVIVES the DTO
    // transform for exactly this — and it was being thrown away in favour of one
    // fixed sentence. "Voice input is not available right now" tells the user
    // their recording is fine and the feature is down; "Could not process your
    // voice note" sends them to test their microphone.
    //
    // The action is a real retry now. The old copy pointed at Notifications,
    // where there was nothing to press: no route, no voice row in the bell, and
    // no endpoint behind either of them.
    toast.error(t('workerFailed'), {
      description: note.failureReason,
      action: { label: t('retry'), onPress: () => onRetry(note.id) },
    })
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
    // The pop-up IS the delivery while the app is open — the push only fires in
    // the background. Each question the worker held becomes a square decision
    // panel (clash → change/keep, gap → answer/later); the plain toast survives
    // only as the fallback for when the notification rows cannot be read, so
    // "needs your input" is never said with nowhere to go.
    const raised = await announceDecisions(since, t, onOpenMatter, onReview).catch(
      (err: unknown) => {
        logger.warn('voiceNote:decision-fetch-failed', { err })
        return 0
      },
    )
    if (raised === 0) {
      toast.info(title, { description, action: { label: t('review'), onPress: onReview } })
    } else if (filed > 0) {
      toast.success(title)
    }
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
  const router = useRouter()
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

  // Lets the retry action start a FRESH watch on the note it just re-queued,
  // without the watch having to reference itself while it is being defined. The
  // ref is written by the effect below, so it always holds the current callback.
  const watchRef = useRef<(noteId: string) => void>(() => {})

  const retry = useCallback((noteId: string) => {
    const t = translateRef.current

    void retryVoiceNote(noteId)
      .then(() => {
        // Queued, not finished. Say so, then watch it exactly as the original
        // upload was watched — the outcome toast is the same one either way.
        toast.info(t('retryQueued'))
        watchRef.current(noteId)
      })
      .catch((err: unknown) => {
        // The server refuses while the provider is known to be down, and that
        // refusal is the useful answer: trying again in ten seconds would fail
        // identically. Anything else is an ordinary failure.
        const unavailable =
          err instanceof ApiError && err.code === 'transcription_unavailable'
        logger.warn('voiceNote:retry-failed', { noteId, err })
        toast.error(unavailable ? t('retryUnavailable') : t('retryFailed'))
      })
  }, [])

  const watch = useCallback(
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
          void announceOutcome(
            note,
            startedAt,
            translateRef.current,
            retry,
            (taskId) => router.push(`/matters?open=${taskId}`),
            () => router.push('/uncertainties'),
          )
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
    [queryClient, retry, router],
  )

  useEffect(() => {
    watchRef.current = watch
  }, [watch])

  return watch
}
