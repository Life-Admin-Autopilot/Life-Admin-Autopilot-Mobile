'use client'

import { CalendarPlus, Clock } from 'lucide-react'

/**
 * When this matter happens — always editable until the row is saved.
 *
 * ONE control for both halves of the question, and it never disappears. The
 * previous split (a "When?" field that vanished once a date arrived, a "What
 * time?" field that vanished once an hour arrived) meant the first pick was
 * final: choosing a time removed the only way to change it, so a mis-tap in a
 * native AM/PM spinner could not be undone without discarding the whole draft.
 *
 * Controlled, not defaultValue, so the field shows what is actually staged and
 * a second pick is just another edit. Nothing here writes to the server — the
 * row's own Save is still the commit.
 *
 * `datetime-local` rather than a date field plus a time field: the user is
 * answering one question, and splitting it invites a date with no hour, which
 * is the state the whole date rule exists to eliminate.
 */
export function WhenField({
  value,
  unanswered,
  onPick,
}: {
  value: Date | null
  unanswered: boolean
  onPick: (next: Date) => void
}) {
  const pad = (n: number) => String(n).padStart(2, '0')
  // Local wall-clock, which is what the control speaks. Reading UTC out of the
  // instant would show an hour the user never chose.
  const asInputValue = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

  return (
    <label
      className={`mt-2 flex flex-wrap items-center gap-2 text-body-sm ${
        unanswered ? 'text-warning' : 'text-ink-muted'
      }`}
    >
      {unanswered ? (
        <CalendarPlus size={14} className="shrink-0" />
      ) : (
        <Clock size={14} className="shrink-0" />
      )}
      <span>{unanswered ? 'When?' : 'When'}</span>
      <input
        type="datetime-local"
        value={value ? asInputValue(value) : ''}
        onChange={(event) => {
          // Empty while the user is mid-edit in some browsers — not a choice.
          if (!event.target.value) return
          const next = new Date(event.target.value)
          if (Number.isNaN(next.getTime())) return
          onPick(next)
        }}
        className={`rounded-pill px-2.5 py-1 text-body-sm text-ink ${
          unanswered ? 'bg-warning/15' : 'bg-surface-field'
        }`}
      />
    </label>
  )
}

