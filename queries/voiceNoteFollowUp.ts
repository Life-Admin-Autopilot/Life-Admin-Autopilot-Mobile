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
import { keepConflict } from '@/lib/conflictKept'
import { markAnnounced, wasAnnounced } from '@/lib/announcedQuestions'
import { CLASH_PANEL_MS } from '@/lib/decisionPanel'
import { requestOpenMatter } from '@/lib/openMatterStore'
import type { Translate } from '@/lib/i18n/translate'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { queryKeys } from '@/queries/keys'
import type { AppNotification } from '@/queries/notifications'
import type { Clarification } from '@/queries/clarifications'
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
  | 'reschedule'
  | 'keepAnyway'
  | 'answerNow'
  | 'later'
  | 'setDate'
  | 'noDateNeeded'
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
 * bell row later land in exactly the same places.
 *
 * Three panels, and which one is chosen is read from DATA, never from the
 * question's wording — the question is written in the user's language, so
 * wording is nobody's contract:
 *
 *   - CLASH ("reschedule / keep it") — the matter's time is checked live.
 *   - MISSING DATE ("set a date / no date needed") — the question's own `kind`.
 *     Both of these send the user to the MATTER, because picking a time there
 *     gets the app's real editor and a clash surfaces the way it does on every
 *     other surface, rather than a second date UI built into a toast.
 *   - anything else ("answer / later") — the card stack, where the chips are.
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
  // Both lists, once. The notification carries the ids and the wording; only the
  // clarification carries `kind`, and `kind` is what separates "we need a date"
  // from "did you mean this?" — two questions with completely different answers.
  const [res, open] = await Promise.all([
    api<{ notifications: AppNotification[] }>('/me/notifications'),
    api<{ clarifications: Clarification[] }>('/me/clarifications').catch(() => ({
      clarifications: [] as Clarification[],
    })),
  ])

  const byId = new Map((open.clarifications ?? []).map((c) => [c.id, c]))

  /**
   * Is this the question that has no date AT ALL?
   *
   * `kind` alone is not enough, and getting that wrong is how the wrong panel
   * reached the wrong question. THREE voice questions are kind `date`: "when is
   * this due?" (no date), "what time on Monday?" (a date, a guessed clock time),
   * and the clash. Keying on `kind` gave the assumed-time question a panel
   * offering "No date needed" — which was false, because the matter had a date,
   * and which would have dropped the very question that existed to confirm the
   * guess.
   *
   * Option ZERO is the honest discriminator, because it is by construction the
   * reading the matter was filed under: null only when the matter is undated.
   */
  const needsADate = (c: Clarification | undefined): boolean =>
    c?.kind === 'date' && !c.options?.[0]?.dueAt

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
    // Never twice for the same question. The window above carries a minute of
    // clock-skew slack, which is exactly wide enough for a second recording to
    // re-announce the first one's question — see lib/announcedQuestions.ts. An
    // ignored question is not answered by this: it keeps its place in the bell.
    .filter((n) => !wasAnnounced(n.clarificationId!))
    // Two at most. A note that raised five questions is a stack problem, and
    // the stack is one tap away on any of these panels.
    .slice(0, 2)

  for (const row of rows) {
    const taskId = row.taskId!
    markAnnounced(row.clarificationId!)
    const clarificationId = row.clarificationId!
    // Sparse body: check the matter exactly as it stands now.
    const found = await previewConflicts(taskId, {})
    const clashing = found.conflicts.length > 0

    if (clashing) {
      toast.decide({
        tone: 'clash',
        title: row.title,
        description: `${row.body ?? ''} — ${found.conflicts[0].reason}`.replace(/^ — /, ''),
        // The chat card's two words, deliberately. A clash raised by speaking and
        // one raised by the agent are the same event, and naming the same action
        // twice ("Change it" here, "Reschedule" there) makes them look like two
        // features with two rules.
        primary: { label: t('reschedule'), onPress: () => onOpenMatter(taskId) },
        secondary: {
          label: t('keepAnyway'),
          // Keeping IS the answer: the matter already holds the time, so the
          // only thing left to clear is the open question about it.
          onPress: () => keepConflict(taskId, clarificationId),
        },
        // Passes, rather than waits. The clash is a fact about two saved matters
        // and stays on the dashboard and in the conflicts sheet after this fades,
        // so the panel announces it instead of being the only copy of it. See the
        // note on `decide` in lib/toast.ts.
        duration: CLASH_PANEL_MS,
      })
    } else if (needsADate(byId.get(clarificationId))) {
      // Filed with no date. Sent to the matter rather than answered in place, so
      // the date is picked with the editor every other surface uses and a clash
      // it causes is shown the way a clash is always shown. Setting it there
      // closes this question on the server — see ClarificationCascade.
      toast.decide({
        tone: 'question',
        title: row.title,
        description: row.body,
        primary: { label: t('setDate'), onPress: () => onOpenMatter(taskId) },
        secondary: {
          label: t('noDateNeeded'),
          onPress: () => keepConflict(taskId, clarificationId),
        },
        duration: CLASH_PANEL_MS,
      })
    } else {
      toast.decide({
        tone: 'question',
        title: row.title,
        description: row.body,
        primary: { label: t('answerNow'), onPress: onOpenStack },
        secondary: { label: t('later'), onPress: () => {} },
        // Passes, like the clash panel beside it. Every question this raises is a
        // persisted Clarification, so it waits in the bell and in the uncertainty
        // stack whatever the panel does — and two voice panels that behave
        // differently for no reason the user can see is its own small confusion.
        duration: CLASH_PANEL_MS,
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

  // UNDERCOUNTS, and cannot be fixed from here. `extractedTasks` holds the
  // auto-save lane only; a matter the worker filed WITH a question attached is a
  // real task in the list, but it lives in the clarify lane, which is stripped
  // from the wire shape. So a note whose one matter clashed reports
  // `extractedTasks: []` while the matter is on the user's dashboard.
  const filed = note.extractedTasks.length
  const held = note.reviewItems.length
  const needsInput = held > 0 || note.status === 'needs_review'

  const title = t('outcomeFiled', { count: filed })
  const description = needsInput
    ? held > 0
      ? t('outcomeNeedsInput', { count: held })
      : t('outcomeNeedsInputUnknown')
    : undefined

  // The pop-up IS the delivery while the app is open — the push only fires in
  // the background. Each question the worker held becomes a square decision
  // panel (clash → reschedule/keep, gap → answer/later); the plain toast
  // survives only as the fallback for when the notification rows cannot be read,
  // so "needs your input" is never said with nowhere to go.
  //
  // Asked on EVERY finished note, not only on one that looks like it needs
  // input, because `needsInput` cannot see a clash. A clash is routed to the
  // clarify lane (VoiceItemGate), the note's status is set from the REVIEW lane
  // alone (VoiceExtractionCommit), and `clarifyItems` is stripped from the wire
  // shape — so a note whose only problem is a double-booking arrives `ready`
  // with an empty `reviewItems` and every signal here reads "all clear". The
  // notification rows are the one place the question is visible to a client, and
  // they are what this reads. Gating on the status meant the matter saved
  // silently and the clash was only ever discoverable in the bell.
  const raised = await announceDecisions(since, t, onOpenMatter, onReview).catch(
    (err: unknown) => {
      logger.warn('voiceNote:decision-fetch-failed', { err })
      return 0
    },
  )

  if (raised > 0) {
    // The panels carry the detail. The count is only spoken when it is safe to —
    // see the note on `filed`: a clash-only note reports zero and saying "0
    // matters filed" beside a panel about a matter that exists is worse than
    // saying nothing about the count at all.
    if (filed > 0) toast.success(title)
    return
  }

  if (needsInput) {
    toast.info(title, { description, action: { label: t('review'), onPress: onReview } })
    return
  }

  // Now it is safe to say nothing was captured: no panel was raised, so no
  // question was held, so the clarify lane really is empty and `filed` really is
  // the whole story. Asked in this order deliberately — the check used to run
  // FIRST, which is how a note whose single matter clashed announced itself as
  // "Nothing was captured" and returned before the clash could be raised.
  if (filed === 0) {
    toast.info(t('nothingCaptured'))
    return
  }

  toast.success(title)
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
            (taskId) => {
              requestOpenMatter(taskId)
              router.push('/matters/')
            },
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
