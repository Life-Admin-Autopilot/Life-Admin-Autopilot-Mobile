'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CalendarPlus, Check, Clock, Loader2, X } from 'lucide-react'

import {
  conflictsFromError,
  previewDraftConflicts,
  useCommitDraft,
  type DraftConflict,
  type TaskDraft,
} from '@/queries/planning'
import { SuggestedSlots } from '@/components/planning/SuggestedSlots'
import { WhenField } from '@/components/planning/WhenField'
import { useIntlTag } from '@/lib/i18n/localeStore'
import { formatDayMonthMaybeYear, formatTime } from '@/lib/i18n/dateFormat'
import { formatCurrency } from '@/lib/i18n/numberFormat'
import { toast } from '@/lib/toast'

/**
 * The confirmation step between "Kitto understood you" and "it is saved".
 *
 * Each draft is its own decision — confirm, skip, done independently — because
 * one sentence can describe three unrelated matters and the user may want only
 * two. A row that has been committed stays visible and checked rather than
 * disappearing, so the list does not reflow under the finger about to tap it.
 *
 * Two things this screen refuses to do quietly:
 *
 *   1. Present a time nobody chose. When the extractor was given a day but no
 *      hour it fills in 09:00 and says so (`timeAssumed`); the row then shows a
 *      time field instead of a settled chip.
 *   2. Save onto a collision on one tap. The clash is already listed on the row,
 *      and the button says "Save anyway" — so the save is a decision about
 *      something visible rather than a discovery made later in the task list.
 */
/**
 * Is this draft complete enough to file without asking?
 *
 * Three things have to be true: a date the user gave (not one we filled in), an
 * extractor that was confident, and nothing it collides with. Any of those
 * missing is a real question, and the row stays for the user to answer.
 */
function isSettled(draft: TaskDraft): boolean {
  return (
    Boolean(draft.dueDate) &&
    !draft.timeAssumed &&
    draft.confidence >= 0.6 &&
    draft.conflicts.length === 0
  )
}

export function DraftReview({
  drafts,
  onFinished,
}: {
  drafts: TaskDraft[]
  onFinished: () => void
}) {
  const commit = useCommitDraft()
  const tag = useIntlTag()
  const [saved, setSaved] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState<number | null>(null)
  const [skipped, setSkipped] = useState<Record<number, boolean>>({})

  // Drafts the user has retimed, and clashes the SERVER reported at commit that
  // the proposal did not know about. Both are keyed by row.
  const [edits, setEdits] = useState<Record<number, TaskDraft>>({})
  const [lateConflicts, setLateConflicts] = useState<Record<number, DraftConflict[]>>({})
  const [slots, setSlots] = useState<Record<number, { at: string[]; why: string }>>({})

  const decided = drafts.every((_, i) => saved[i] || skipped[i])

  // File the unambiguous ones immediately.
  //
  // "You said Thursday at 6, Kitto heard Thursday at 6" is not a decision worth
  // a tap — making the user confirm it teaches them to confirm without reading,
  // which is exactly the habit that lets a WRONG draft through later. So the
  // confirmation step is spent only on drafts that actually hold a question:
  // a missing date, an hour we invented, low confidence, or a clash.
  //
  // Runs once per mount. `autoFiledRef` guards it because the effect re-runs as
  // rows settle, and a second pass would double-file a matter already saved.
  const autoFiledRef = useRef(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A pending auto-close must not fire into an unmounted panel, and must not
  // outlive a user who closed it by hand first.
  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (autoFiledRef.current) return
    autoFiledRef.current = true

    const settled = drafts
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => isSettled(draft))
    if (settled.length === 0) return

    void (async () => {
      let filed = 0
      for (const { draft, index } of settled) {
        try {
          await commit.mutateAsync({ draft, confirmConflicts: false })
          setSaved((s) => ({ ...s, [index]: true }))
          filed += 1
        } catch (err) {
          // A clash that appeared between propose and commit, or a date the
          // server rejected. Either way it becomes a question again rather than
          // failing silently — the row stays and the user decides.
          const refused = conflictsFromError(err)
          if (refused) setLateConflicts((c) => ({ ...c, [index]: refused }))
        }
      }

      // Nothing left to ask, so nothing left to look at. Leaving the panel up
      // after every matter filed itself made the capture surface feel like it
      // had not finished — the mic was done, the tasks were saved, and the only
      // thing still on screen was a Done button with no decision behind it.
      // The beat is long enough to read the ticks, short enough not to be a wait.
      if (filed === drafts.length) {
        closeTimerRef.current = setTimeout(onFinished, 1400)
      }
    })()
    // Mount-only: `drafts` is the proposal for this turn and does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * The user answered "when?" — apply it, then immediately ask whether the slot
   * they chose is free.
   *
   * Checking on pick rather than only on Save is the difference between "that
   * time is taken, choose another" and "refused, now go back and choose
   * another". The pick is a discrete event, so there is nothing to debounce.
   *
   * The result only ever ADDS a warning; it never blocks. The server re-checks
   * at the write and is the actual enforcement, so a failed or slow preview
   * costs the user nothing.
   */
  const retime = (
    index: number,
    draft: TaskDraft,
    next: Date,
    extra: Partial<TaskDraft> = {},
  ) => {
    const edited: TaskDraft = {
      ...draft,
      ...extra,
      dueDate: next.toISOString(),
      timeAssumed: false,
    }
    setEdits((e) => ({ ...e, [index]: edited }))
    // Drop the previous verdict straight away: it was about a different time,
    // and leaving it up would attribute an old clash to the new choice.
    setLateConflicts((c) => ({ ...c, [index]: [] }))
    setSlots((v) => ({ ...v, [index]: { at: [], why: '' } }))

    void previewDraftConflicts(edited).then((preview) => {
      setLateConflicts((c) => ({ ...c, [index]: preview.conflicts }))
      setSlots((v) => ({
        ...v,
        [index]: { at: preview.suggestions, why: preview.suggestionReason },
      }))
    })
  }

  const save = async (draft: TaskDraft, index: number, conflicts: DraftConflict[]) => {
    setBusy(index)
    try {
      // Only assert confirmation for clashes actually on screen. Sending it
      // unconditionally would turn the server's refusal into a formality.
      await commit.mutateAsync({ draft, confirmConflicts: conflicts.length > 0 })
      setSaved((s) => ({ ...s, [index]: true }))
    } catch (err) {
      const refused = conflictsFromError(err)
      if (refused) {
        // A clash that appeared after the proposal — another matter landed there,
        // or this draft was retimed onto one. Show it and let them decide.
        setLateConflicts((c) => ({ ...c, [index]: refused }))
        toast.error('That clashes with something already scheduled.')
      } else {
        toast.error('Could not save that one. Try again.')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-label uppercase tracking-wide text-ink-subtle">
        {drafts.length === 1 ? 'Confirm this' : `Confirm ${drafts.length} matters`}
      </p>

      <div className="flex flex-col gap-2">
        {drafts.map((proposed, index) => {
          const draft = edits[index] ?? proposed
          const isSaved = saved[index]
          const isSkipped = skipped[index]
          const due = draft.dueDate ? new Date(draft.dueDate) : null
          const conflicts = lateConflicts[index] ?? draft.conflicts
          const needsDate = !due
          const needsTime = Boolean(draft.timeAssumed && due)

          return (
            <div
              key={`${proposed.title}-${index}`}
              className={`rounded-2xl border p-3 transition-opacity ${
                isSkipped ? 'border-hairline opacity-40' : 'border-hairline'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-ink" dir="auto">
                    {draft.title}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip>{draft.category}</Chip>
                    {draft.priority !== 'normal' ? <Chip>{draft.priority}</Chip> : null}
                    {due ? (
                      <Chip>
                        {formatDayMonthMaybeYear(due, new Date(), tag)}
                        {draft.kind === 'reminder' && !needsTime
                          ? `, ${formatTime(due, tag)}`
                          : ''}
                      </Chip>
                    ) : (
                      <Chip>no date</Chip>
                    )}
                    {/* Surfaced only when the extractor is unsure — a confidence
                        badge on every row is noise that trains people to ignore it. */}
                    {draft.confidence < 0.6 ? <Chip tone="warn">unsure</Chip> : null}
                    {/* The figure that will actually be filed, shown BEFORE the
                        save rather than discovered on /money afterwards. A
                        misheard amount is the one field here the user cannot
                        infer from the title, so it has to be on the card. */}
                    {draft.amount ? (
                      <Chip>
                        {formatCurrency(draft.amount.amountMinor, draft.amount.currency, tag)}
                      </Chip>
                    ) : null}
                  </div>

                  {!isSaved && !isSkipped ? (
                    <WhenField
                      value={due}
                      unanswered={needsDate || needsTime}
                      onPick={(next) =>
                        retime(index, draft, next, needsDate ? { kind: 'reminder' } : {})
                      }
                    />
                  ) : null}

                  {conflicts.length > 0 ? (
                    <ul className="mt-2 flex flex-col gap-1">
                      {conflicts.map((conflict) => (
                        <li
                          key={conflict.taskId}
                          className="flex items-start gap-1.5 text-body-sm text-warning"
                        >
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          <span>
                            {conflict.reason}{' '}
                            <span className="text-ink-muted">“{conflict.title}”</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {conflicts.length > 0 && !isSaved && !isSkipped ? (
                    <SuggestedSlots
                      slots={slots[index]?.at ?? []}
                      reason={slots[index]?.why ?? ''}
                      onPick={(next) => retime(index, draft, next)}
                    />
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {isSaved ? (
                    <span className="grid size-9 place-items-center rounded-full bg-accent/15 text-accent">
                      <Check size={18} />
                    </span>
                  ) : isSkipped ? null : (
                    <>
                      <button
                        aria-label={`Skip ${draft.title}`}
                        onClick={() => setSkipped((s) => ({ ...s, [index]: true }))}
                        disabled={busy !== null}
                        className="grid size-9 place-items-center rounded-full bg-surface-field text-ink-muted disabled:opacity-50"
                      >
                        <X size={16} />
                      </button>
                      <button
                        aria-label={
                          needsDate
                            ? `${draft.title} needs a date before it can be saved`
                            : conflicts.length > 0
                              ? `Save ${draft.title} despite the clash`
                              : `Save ${draft.title}`
                        }
                        onClick={() => void save(draft, index, conflicts)}
                        // The server refuses an undated capture, so offering Save
                        // here would only produce an error the user cannot read.
                        // The date field above it is the way forward.
                        disabled={busy !== null || needsDate}
                        className={`grid h-9 place-items-center rounded-full disabled:opacity-50 ${
                          conflicts.length > 0
                            ? 'bg-warning px-3 text-body-sm font-medium text-accent-ink'
                            : 'w-9 bg-accent text-accent-ink'
                        }`}
                      >
                        {busy === index ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : conflicts.length > 0 ? (
                          'Save anyway'
                        ) : (
                          <Check size={18} />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <button
        onClick={onFinished}
        className="mt-1 rounded-pill bg-accent px-6 py-2.5 text-body-sm font-medium text-accent-ink"
      >
        {decided ? 'Done' : 'Close'}
      </button>
    </div>
  )
}

/**
 * "You said the day, not the hour — which hour?"
 *
 * A native `time` input rather than a set of suggested times: the day is already
 * decided, so the only open question is a value the user holds exactly, and a
 * picker answers it in one interaction instead of offering four guesses that are
 * probably all wrong.
 *
 * Skipping it is allowed. The placeholder stays, the matter still gets filed, and
 * the user has at least been told which part of it Kitto made up.
 */
function Chip({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <span
      className={`rounded-pill px-2 py-0.5 text-label ${
        tone === 'warn' ? 'bg-warning/15 text-warning' : 'bg-surface-field text-ink-muted'
      }`}
    >
      {children}
    </span>
  )
}
