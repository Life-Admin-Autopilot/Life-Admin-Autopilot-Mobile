'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import { CategorizeDiffRow } from '@/components/matters/CategorizeDiffRow'
import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
import { env } from '@/lib/env'
import { toast } from '@/lib/toast'
import {
  useApplyProposal,
  useDiscardProposal,
  type Proposal,
} from '@/queries/categorize'

// Review the AI's proposed filing.
//
// Nothing here has happened yet — the proposal is staged server-side and the
// matters are untouched until Apply. That is the whole reason this screen
// exists: a domain is required on every matter, so categorising always
// overwrites an answer that was already there, sometimes one the user picked
// themselves. A pass that wrote straight through would be silently editing
// their filing and calling it help.

export function CategorizeSheet({
  open,
  loading,
  failed,
  selectedCount,
  proposal,
  trigger,
  onClose,
  onApplied,
}: {
  open: boolean
  /** The model is still thinking. The sheet opens BEFORE this resolves. */
  loading: boolean
  failed: boolean
  /** How many matters were handed over — the loading copy needs a number. */
  selectedCount: number
  proposal: Proposal | null
  trigger: DOMRect | null
  onClose: () => void
  /** Hands back the undo token so the caller can offer the change back. */
  onApplied: (applied: number, undoToken: string | null) => void
}) {
  const t = useTranslations('matters')
  const tCommon = useTranslations('common')
  const apply = useApplyProposal()
  const discard = useDiscardProposal()

  const changes = useMemo(() => proposal?.changes ?? [], [proposal])

  // High confidence starts ticked, everything else starts clear.
  //
  // This is the one place the model's self-assessment does real work: a
  // "medium" that arrives pre-ticked gets applied by anyone who taps Apply
  // without reading, which would make the confidence field decorative. The
  // user opts IN to the guesses.
  //
  // Held against the proposal id and reconciled DURING RENDER rather than in an
  // effect — the same trick the Matters list uses for its held rows. Resetting
  // from an effect would tick the boxes one render after the rows appear, so a
  // fast tap on Apply could commit an empty set.
  const opId = proposal?.opId ?? ''
  const [ticked, setTicked] = useState<{ opId: string; ids: Set<string> }>({
    opId: '',
    ids: new Set(),
  })
  const checked =
    ticked.opId === opId
      ? ticked.ids
      : new Set(changes.filter((c) => c.confidence === 'high').map((c) => c.taskId))

  const replace = (ids: Set<string>) => setTicked({ opId, ids })

  const toggle = (taskId: string) => {
    const next = new Set(checked)
    if (next.has(taskId)) next.delete(taskId)
    else next.add(taskId)
    replace(next)
  }

  const allChecked = changes.length > 0 && checked.size === changes.length
  const busy = apply.isPending || discard.isPending

  const onApply = () => {
    if (!proposal) return
    apply.mutate(
      { opId: proposal.opId, taskIds: [...checked] },
      {
        onSuccess: (res) => {
          onApplied(res.applied, res.undoToken)
          onClose()
        },
        onError: () => toast.error(t('toast.actionFailed')),
      },
    )
  }

  const onDiscard = () => {
    if (!proposal) return
    discard.mutate(proposal.opId, {
      onSuccess: () => {
        toast.info(t('categorize.dismissed'))
        onClose()
      },
      onError: () => toast.error(t('categorize.dismissFailed')),
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title={loading ? t('categorize.loadingTitle') : t('categorize.title')}
      eyebrow={
        changes.length > 0 && !loading
          ? t('categorize.eyebrow', { count: changes.length })
          : undefined
      }
      height={560}
      footer={
        changes.length > 0 && !loading ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={busy}
              className="rounded-pill px-4 py-3 text-body-sm font-bold text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {t('categorize.dismiss')}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={busy || checked.size === 0}
              className="flex-1 rounded-pill bg-solid px-4 py-3 text-body-sm font-bold text-solid-ink transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {checked.size === 0
                ? t('categorize.nothingSelected')
                : t('categorize.apply', { count: checked.size })}
            </button>
          </div>
        ) : null
      }
    >
      {loading ? (
        // The wait is a Gemini round trip — seconds, not milliseconds. This
        // panel exists because the alternative was a dead app: the sheet used
        // to open only once the answer landed, so tapping the button looked
        // like it had done nothing at all.
        //
        // It also does the explaining. Nowhere else in the flow said what this
        // feature actually does, and the moment the user is waiting is exactly
        // when they are willing to read it.
        <div className="flex flex-col gap-4">
          <p className="text-body text-ink-muted">
            {t.rich('categorize.loadingBody', {
              count: selectedCount,
              app: env.appName,
              b: (chunks: React.ReactNode) => (
                <span className="font-bold tabular text-ink">{chunks}</span>
              ),
            })}
          </p>
          <p className="rounded-2xl bg-surface-field px-4 py-3 text-body-sm text-ink-muted">
            {t('categorize.loadingNote')}
          </p>
          <ul className="flex flex-col gap-2" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-start gap-3 rounded-2xl bg-surface-field px-3 py-3">
                <div className="mt-0.5 size-5 shrink-0 animate-pulse rounded-md bg-surface-sunken" />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="h-4 w-2/3 animate-pulse rounded-pill bg-surface-sunken" />
                  <div className="h-3 w-1/2 animate-pulse rounded-pill bg-surface-sunken" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <SketchEmptyTrayGlyph />
          <p className="mt-2 font-display text-heading-serif text-ink">
            {t('categorize.failedTitle')}
          </p>
          <p className="max-w-[32ch] text-body text-ink-muted">{t('categorize.failedBody')}</p>
        </div>
      ) : changes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <SketchEmptyTrayGlyph />
          <p className="mt-2 font-display text-heading-serif text-ink">
            {t('categorize.cleanTitle')}
          </p>
          <p className="max-w-[32ch] text-body text-ink-muted">
            {t('categorize.cleanBody', { count: selectedCount, app: env.appName })}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Restates the deal at the moment of decision. The loading panel
              said it too, but that panel is gone by the time anyone is
              actually looking at a checkbox. */}
          {/* "the area on the right" was the old wording. There is no right in
              Arabic — the arrow in each row points the other way — so the copy
              names the suggestion rather than a side of the screen. */}
          <p className="text-body-sm text-ink-muted">
            {t('categorize.explain', { app: env.appName })}
          </p>
          <button
            type="button"
            onClick={() =>
              replace(allChecked ? new Set() : new Set(changes.map((c) => c.taskId)))
            }
            className={cn(
              'self-start rounded-pill px-3 py-1.5 text-body-sm font-bold transition-colors',
              'bg-surface-field text-ink-muted hover:text-ink',
            )}
          >
            {allChecked ? t('categorize.selectNone') : tCommon('selectAll')}
          </button>

          <ul className="flex flex-col gap-2">
            {changes.map((change) => (
              <CategorizeDiffRow
                key={change.taskId}
                change={change}
                checked={checked.has(change.taskId)}
                onToggle={() => toggle(change.taskId)}
              />
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  )
}
