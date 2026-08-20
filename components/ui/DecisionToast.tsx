'use client'

import { AlertTriangle, HelpCircle } from 'lucide-react'

/**
 * A question that arrived while the app was open — rendered as a small square
 * panel at the top of the screen, not a passing toast line.
 *
 * The passing line was tried first and it under-serves this moment: "1 needs
 * your input" is a STATEMENT, and what the worker actually produced is a
 * DECISION — this matter clashes with that one; change it or keep it? A
 * decision gets a surface with the two answers on it, differently weighted, so
 * taking either costs one tap and ignoring it costs nothing (sonner's dismiss
 * and stacking still own the lifecycle).
 *
 * Deliberately dumb: two labelled callbacks and some text. What the buttons DO
 * — deep-link to the matter, drop a clarification, open the stack — belongs to
 * the caller, because this same square asks both clash questions ("change it?")
 * and plain ones ("answer now?").
 */
export function DecisionToast({
  tone,
  title,
  description,
  primary,
  secondary,
}: {
  tone: 'clash' | 'question'
  title: string
  description?: string
  primary: { label: string; onPress: () => void }
  secondary: { label: string; onPress: () => void }
}) {
  const Icon = tone === 'clash' ? AlertTriangle : HelpCircle
  return (
    <div className="w-full max-w-90 rounded-2xl bg-surface p-3.5 shadow-elevated">
      <div className="flex items-start gap-2.5">
        <Icon
          size={16}
          className={`mt-0.5 shrink-0 ${tone === 'clash' ? 'text-warning' : 'text-accent'}`}
        />
        <div className="flex min-w-0 flex-col">
          <span className="text-body-sm font-medium text-ink" dir="auto">
            {title}
          </span>
          {description ? (
            <span className="mt-0.5 text-caption text-ink-muted" dir="auto">
              {description}
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {/* The change is the accent action, the keep is the warning one — the
            colours carry the same meaning the matters sheet gives them. */}
        <button
          type="button"
          onClick={primary.onPress}
          className="flex-1 rounded-pill bg-accent px-3 py-1.5 text-caption font-medium text-accent-ink"
        >
          {primary.label}
        </button>
        <button
          type="button"
          onClick={secondary.onPress}
          className={`flex-1 rounded-pill px-3 py-1.5 text-caption font-medium ${
            tone === 'clash' ? 'bg-warning text-accent-ink' : 'bg-surface-field text-ink-muted'
          }`}
        >
          {secondary.label}
        </button>
      </div>
    </div>
  )
}
