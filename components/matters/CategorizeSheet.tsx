'use client'

import { useEffect, useMemo, useState } from 'react'

import { CategorizeDiffRow } from '@/components/matters/CategorizeDiffRow'
import { SketchEmptyTrayGlyph } from '@/components/icons/sketch/flowGlyphs'
import { Sheet } from '@/components/ui/Sheet'
import { cn } from '@/lib/cn'
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
  proposal,
  trigger,
  onClose,
  onApplied,
}: {
  open: boolean
  proposal: Proposal | null
  trigger: DOMRect | null
  onClose: () => void
  /** Hands back the undo token so the caller can offer the change back. */
  onApplied: (applied: number, undoToken: string | null) => void
}) {
  const apply = useApplyProposal()
  const discard = useDiscardProposal()

  const changes = useMemo(() => proposal?.changes ?? [], [proposal])

  // High confidence starts ticked, everything else starts clear.
  //
  // This is the one place the model's self-assessment does real work: a
  // "medium" that arrives pre-ticked gets applied by anyone who taps Apply
  // without reading, which would make the confidence field decorative. The
  // user opts IN to the guesses.
  const [checked, setChecked] = useState<Set<string>>(new Set())
  useEffect(() => {
    setChecked(new Set(changes.filter((c) => c.confidence === 'high').map((c) => c.taskId)))
  }, [changes])

  const toggle = (taskId: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
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
        onError: () => toast.error('That did not go through. Try again.'),
      },
    )
  }

  const onDiscard = () => {
    if (!proposal) return
    discard.mutate(proposal.opId, {
      onSuccess: () => {
        toast.info('Suggestions dismissed.')
        onClose()
      },
      onError: () => toast.error('Could not dismiss those.'),
    })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      trigger={trigger}
      title="Suggested filing"
      eyebrow={
        changes.length > 0
          ? `${changes.length} ${changes.length === 1 ? 'matter' : 'matters'} · nothing changed yet`
          : undefined
      }
      height={560}
      footer={
        changes.length > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDiscard}
              disabled={busy}
              className="rounded-pill px-4 py-3 text-body-sm font-bold text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={busy || checked.size === 0}
              className="flex-1 rounded-pill bg-solid px-4 py-3 text-body-sm font-bold text-solid-ink transition-transform active:scale-[0.98] disabled:opacity-40"
            >
              {checked.size === 0 ? 'Nothing selected' : `Apply ${checked.size}`}
            </button>
          </div>
        ) : null
      }
    >
      {changes.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <SketchEmptyTrayGlyph />
          <p className="mt-2 font-display text-heading-serif text-ink">Already filed right.</p>
          <p className="max-w-[30ch] text-body text-ink-muted">
            Nothing worth moving in what you picked.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() =>
              setChecked(allChecked ? new Set() : new Set(changes.map((c) => c.taskId)))
            }
            className={cn(
              'self-start rounded-pill px-3 py-1.5 text-body-sm font-bold transition-colors',
              'bg-surface-field text-ink-muted hover:text-ink',
            )}
          >
            {allChecked ? 'Select none' : 'Select all'}
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
