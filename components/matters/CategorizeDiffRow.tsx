'use client'

import { ArrowRight, Check } from 'lucide-react'

import { EmojiChip } from '@/components/ui/EmojiChip'
import { domainCategory, domainEmoji } from '@/components/icons/DomainIcon'
import { cn } from '@/lib/cn'
import { DOMAIN_LABEL } from '@/queries/tasks'
import type { Confidence, ProposedChange } from '@/queries/categorize'

// One proposed refiling, as a reviewable line.
//
// The row has to answer "what is changing and should I let it" at a glance,
// so the before and after sit next to each other rather than the after alone.
// Showing only the destination would ask the user to remember where each
// matter currently lives, which is exactly the thing they opened this to
// stop doing.

// Low confidence is called out; high is not. A badge on every row is a badge
// on no row — the useful signal is "this one is a guess", and the checkbox
// already starts unticked to say so.
const CONFIDENCE_COPY: Record<Confidence, string | null> = {
  high: null,
  medium: 'fairly sure',
  low: 'a guess',
}

export function CategorizeDiffRow({
  change,
  checked,
  onToggle,
}: {
  change: ProposedChange
  checked: boolean
  onToggle: () => void
}) {
  const moved = change.fromDomain !== change.toDomain
  const note = CONFIDENCE_COPY[change.confidence]

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        className={cn(
          'flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors',
          checked ? 'bg-accent-soft' : 'bg-surface-field hover:brightness-[0.98]',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border-2 transition-colors',
            checked ? 'border-accent bg-accent text-accent-ink' : 'border-border',
          )}
        >
          {checked ? <Check size={13} strokeWidth={3} /> : null}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-body font-bold text-ink">{change.title}</span>

          {moved ? (
            <span className="flex items-center gap-1.5 text-body-sm text-ink-muted">
              <EmojiChip
                emoji={domainEmoji(change.fromDomain)}
                category={domainCategory(change.fromDomain)}
                size={22}
              />
              <span className="line-through">{DOMAIN_LABEL[change.fromDomain]}</span>
              <ArrowRight size={13} className="shrink-0 text-accent" />
              <EmojiChip
                emoji={domainEmoji(change.toDomain)}
                category={domainCategory(change.toDomain)}
                size={22}
              />
              <span className="font-bold text-ink">{DOMAIN_LABEL[change.toDomain]}</span>
            </span>
          ) : null}

          {change.addedTags.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1">
              {change.addedTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-pill bg-surface px-2 py-0.5 text-caption text-ink-muted"
                >
                  +{tag}
                </span>
              ))}
            </span>
          ) : null}

          {change.reason ? (
            <span className="text-caption text-ink-subtle">
              {change.reason}
              {note ? <span className="text-ink-subtle"> · {note}</span> : null}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
