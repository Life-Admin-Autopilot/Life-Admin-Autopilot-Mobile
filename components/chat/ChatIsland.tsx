'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, RotateCcw, SendHorizontal, Square, X } from 'lucide-react'

import chatbotImg from '@/assets/brand/chatbot.png'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import { MORPH_BACKDROP_FADE, MORPH_SPRING } from '@/lib/motion'
import { useAskAi } from '@/queries/ai'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'

// Motion seam: framer interpolates concrete colors, not CSS vars. Mirror
// --color-accent (crimson) / --color-surface (white) from tokens.md.
const CRIMSON = 'rgb(164 22 26)'
const WHITE = 'rgb(255 255 255)'

const SHAPES: Record<'fab' | 'panel', MorphShape> = {
  fab: { width: 50, height: 50, radius: 32, background: CRIMSON },
  panel: { width: 360, height: 520, radius: 24, background: WHITE },
}

// The chatbot — the bridge to the King. A crimson medallion FAB (with an
// explicit "Ask the King" label so the affordance is unmistakable) morphs
// (Dynamic Island engine) into a chat panel wired to the live AI backend:
// streamed replies, task tools with destructive confirmation, and voice.
export function ChatIsland() {
  const [open, setOpen] = useState(false)
  const state: 'fab' | 'panel' = open ? 'panel' : 'fab'

  return (
    <>
      {/* Backdrop — a soft blur + dim that fades in while the island is
          expanded (chat or in-panel voice). Tapping it dismisses the panel. */}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="chat-backdrop"
            variants={MORPH_BACKDROP_FADE}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setOpen(false)}
            aria-hidden
            className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-md"
          />
        ) : null}
      </AnimatePresence>

      <div className="fixed bottom-24 right-5 z-40 flex items-center gap-2.5">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-pill border border-border bg-surface px-3.5 py-2 text-label uppercase tracking-wide text-ink shadow-elevated transition-colors hover:bg-surface-sunken"
          >
            Ask the King
          </button>
        ) : null}
      <MorphSurface
        state={state}
        shapes={SHAPES}
        onClick={open ? undefined : () => setOpen(true)}
        role={open ? 'dialog' : 'button'}
        aria-label={open ? 'The King' : 'Ask the King'}
        className={`shadow-2xl ${open ? '' : 'cursor-pointer ring-2 ring-accent/40'}`}
      >
        {state === 'fab' ? (
          <div className="relative grid h-full w-full place-items-center">
            <Image src={chatbotImg} alt="" fill sizes="50px" className="object-cover" priority />
          </div>
        ) : (
          <ChatPanel onClose={() => setOpen(false)} />
        )}
      </MorphSurface>
      </div>
    </>
  )
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const {
    status,
    messages,
    pending,
    pendingConfirm,
    error,
    failedQuestion,
    ask,
    retry,
    clear,
    confirm,
    isLoadingConversation,
  } = useAskAi()
  const recorder = useVoiceRecorder()
  const [input, setInput] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const isStreaming = status === 'streaming'
  const isBusy = isStreaming || transcribing
  const isRecording = recorder.phase === 'recording'

  // Autoscroll to the tail on any new content.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending, transcribing])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy) return
    setInput('')
    void ask(trimmed, timezone)
  }

  const stopAndSend = async () => {
    const blob = await recorder.stop()
    if (!blob) return
    setTranscribing(true)
    try {
      const text = await transcribeAudio(blob)
      if (text.trim()) void ask(text.trim(), timezone)
      else toast.info('Nothing was captured.')
    } catch (err) {
      toast.error(translateBackendError(err, 'Could not transcribe that.'))
    } finally {
      setTranscribing(false)
    }
  }

  // One list: committed messages plus the in-flight draft as the last item. The
  // draft keeps its index when it finalizes, so the bubble never remounts.
  const rendered = pending ? [...messages, pending] : messages
  const empty = messages.length === 0 && !pending && !isLoadingConversation

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-heading-md text-ink">The King</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void clear()}
            aria-label="Clear conversation"
            className="grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={onClose}
            aria-label="Close assistant"
            className="grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-3">
        {empty ? (
          <p className="m-auto max-w-[80%] text-center text-body-sm text-ink-subtle">
            Speak. Order follows.
          </p>
        ) : null}

        {/* Render the in-flight draft as the LAST item of one list with stable
            index keys. When the draft finalizes (pending → committed message) it
            keeps the same index/key, so the bubble updates in place instead of
            remounting — no flicker, no momentary double. New turns animate in
            with the morph spring (the Dynamic Island "expand" feel). */}
        {rendered.map((m, i) => {
          const isPending = pending !== null && i === rendered.length - 1
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.8, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={MORPH_SPRING}
              style={{ transformOrigin: m.role === 'user' ? 'bottom right' : 'bottom left' }}
            >
              <ChatMessage
                message={m}
                streaming={isPending}
                onConfirm={(id) => void confirm(id, 'confirm')}
                onDecline={(id) => void confirm(id, 'decline')}
                onAnswer={(text) => send(text)}
                pendingConfirm={pendingConfirm}
              />
            </motion.div>
          )
        })}

        {transcribing ? (
          <p className="text-caption text-ink-subtle">Transcribing…</p>
        ) : null}

        {status === 'error' && error ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2">
            <span className="text-caption text-ink-muted">{error}</span>
            {failedQuestion ? (
              <button
                onClick={() => retry(timezone)}
                className="shrink-0 text-caption font-medium text-accent hover:underline"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border px-3 py-3">
        {isRecording ? (
          <div className="flex items-center gap-3">
            <Meter />
            <span className="tabular text-heading-sm text-ink">{formatElapsed(recorder.elapsedMs)}</span>
            <button
              onClick={() => void recorder.stop()}
              aria-label="Discard recording"
              className="ml-auto grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X size={16} />
            </button>
            <button
              onClick={() => void stopAndSend()}
              aria-label="Send recording"
              className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink"
            >
              <Square size={13} fill="currentColor" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send(input)
              }}
              aria-label="Message the assistant"
              placeholder="Speak or type…"
              disabled={isBusy}
              className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none placeholder:text-ink-subtle disabled:opacity-60"
            />
            {input.trim().length > 0 ? (
              <button
                onClick={() => send(input)}
                disabled={isBusy}
                aria-label="Send message"
                className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink disabled:opacity-50"
              >
                <SendHorizontal size={16} />
              </button>
            ) : (
              <button
                onClick={() => void recorder.start()}
                disabled={isBusy}
                aria-label="Start voice capture"
                className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink disabled:opacity-50"
              >
                <Mic size={16} />
              </button>
            )}
          </div>
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

// Calm crimson level bars — static heights (no bouncing spectacle), per the
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
