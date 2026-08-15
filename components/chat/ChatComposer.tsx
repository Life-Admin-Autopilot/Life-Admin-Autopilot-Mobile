'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { ArrowUp, Mic, Square, X } from 'lucide-react'

import { useCoarsePointer } from '@/hooks/useCoarsePointer'
import { cn } from '@/lib/cn'

// The message box.
//
// A single-line <input> could not hold a dictated paragraph, could not accept a
// deliberate line break, and silently scrolled away everything but the last few
// words — so a long message became impossible to proof-read before sending.
// This is a textarea that grows with its content and stops at MAX_ROWS.
//
// Enter's meaning is a real fork, not a preference:
//   - pointer devices → Enter sends, Shift+Enter breaks the line (the shortcut
//     every desktop chat client has trained)
//   - touch devices → Enter is the keyboard's own return key and MUST insert a
//     break; sending is the button. Hijacking it there means a phone user has
//     no way to type a second line.
// `isComposing` is checked first regardless: an IME (Arabic, CJK) uses Enter to
// commit a candidate, and treating that as send truncates the word mid-entry.

interface ChatComposerProps {
  onSend: (text: string) => void
  /** Abandon the in-flight turn. Rendered as the stop control while streaming. */
  onStop: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  onDiscardRecording: () => void
  isStreaming: boolean
  isTranscribing: boolean
  isRecording: boolean
  elapsedMs: number
}

export function ChatComposer({
  onSend,
  onStop,
  onStartRecording,
  onStopRecording,
  onDiscardRecording,
  isStreaming,
  isTranscribing,
  isRecording,
  elapsedMs,
}: ChatComposerProps) {
  const t = useTranslations('chat')
  const [value, setValue] = useState('')
  const isTouch = useCoarsePointer()

  const send = () => {
    const trimmed = value.trim()
    if (trimmed.length === 0 || isStreaming || isTranscribing) return
    setValue('')
    onSend(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    // Mid-composition: the IME owns this keystroke.
    if (e.nativeEvent.isComposing) return
    if (isTouch && !e.metaKey && !e.ctrlKey) return
    if (e.shiftKey) return
    e.preventDefault()
    send()
  }

  if (isRecording) {
    return (
      <div className="border-t border-border px-3 py-3">
        <div className="flex items-center gap-3">
          <Meter />
          <span className="tabular text-heading-sm text-ink">{formatElapsed(elapsedMs)}</span>
          <button
            type="button"
            onClick={onDiscardRecording}
            aria-label={t('discardRecording')}
            className="ms-auto grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onStopRecording}
            aria-label={t('sendRecording')}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink"
          >
            <Square size={13} fill="currentColor" />
          </button>
        </div>
      </div>
    )
  }

  const hasText = value.trim().length > 0

  return (
    <div className="border-t border-border px-3 py-3">
      <div className="flex items-end gap-2">
        {/* Auto-grow with no measurement: the invisible mirror below holds the
            same text and dictates the row height, and the textarea is stacked
            on top of it in the same grid cell. Purely layout, so it tracks the
            box's real width at all times.

            The JS version this replaces measured scrollHeight in an effect —
            which first ran while the island was still morphing out of the 50px
            FAB. At that width the placeholder wrapped to six lines, the height
            was pinned to the cap, and nothing ever re-measured it: the composer
            opened as a tall empty slab. */}
        <div className="grid max-h-30 min-w-0 flex-1 overflow-y-auto rounded-2xl bg-surface-field px-3.5 py-2">
          <span
            aria-hidden
            dir="auto"
            className="invisible col-start-1 row-start-1 whitespace-pre-wrap break-words text-body-sm"
          >
            {/* The trailing space gives a finished line somewhere to sit, so
                pressing Enter on the last row grows the box. */}
            {value}{' '}
          </span>
          <textarea
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label={t('composerLabel')}
            placeholder={t('composerPlaceholder')}
            disabled={isTranscribing}
            dir="auto"
            className={cn(
              'col-start-1 row-start-1 w-full resize-none overflow-hidden bg-transparent',
              'text-body-sm text-ink outline-none placeholder:text-ink-muted disabled:opacity-60',
            )}
          />
        </div>

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            aria-label={t('stopResponse')}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-ink text-canvas transition-opacity hover:opacity-90"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : hasText ? (
          <button
            type="button"
            onClick={send}
            disabled={isTranscribing}
            aria-label={t('sendMessage')}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <ArrowUp size={17} strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onStartRecording}
            disabled={isTranscribing}
            aria-label={t('startVoice')}
            className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Mic size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Calm purple level bars — static heights (no bouncing spectacle), per the
// restrained motion philosophy (matches the showcase recording island).
function Meter() {
  const bars = [6, 12, 8, 16, 10, 14, 7]
  return (
    <div className="flex h-6 items-center gap-1">
      {bars.map((h, i) => (
        <span key={i} className="w-1 rounded-pill bg-accent" style={{ height: h }} />
      ))}
    </div>
  )
}
