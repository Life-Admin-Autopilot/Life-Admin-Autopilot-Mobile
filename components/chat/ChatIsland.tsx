'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, RotateCcw, SendHorizontal, Square, X } from 'lucide-react'

import chatbotImg from '@/assets/ghost/logo.png'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'
import { isAppChatRoute } from '@/lib/appRoutes'
import { BACKDROP_BLUR_FADE, BACKDROP_BLUR_STYLE } from '@/lib/motion-backdrop'
import { MORPH_SPRING } from '@/lib/motion'
import { useMorphColors } from '@/lib/motion-colors'
import { useAskAi } from '@/queries/ai'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { micFailureMessage } from '@/lib/ai/micFailure'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { env } from '@/lib/env'

// The chatbot — the bridge to the assistant. A mascot medallion FAB (with an
// explicit "Ask <app name>" label so the affordance is unmistakable)
// morphs (Dynamic Island engine) into a chat panel wired to the live AI
// backend: streamed replies, task tools with destructive confirmation, voice.
// Mounted once in Providers, as a sibling of the route slot, so it decides for
// itself where it belongs: signed-in app surfaces only, never the auth /
// onboarding screens, which run their own morphing island. Gating out here
// (rather than inside the surface) also unmounts the panel on the way out, so
// an open conversation can't spring back when the next app route mounts.
export function ChatIsland() {
  const pathname = usePathname()
  if (!isAppChatRoute(pathname)) return null
  return <ChatIslandSurface />
}

function ChatIslandSurface() {
  const t = useTranslations('chat')
  const [open, setOpen] = useState(false)
  const state: 'fab' | 'panel' = open ? 'panel' : 'fab'
  const { accent, surface } = useMorphColors()
  const shapes: Record<'fab' | 'panel', MorphShape> = useMemo(
    () => ({
      fab: { width: 50, height: 50, radius: 32, background: accent },
      panel: { width: 330, height: 620, radius: 24, background: surface },
    }),
    [accent, surface],
  )

  return (
    <>
      {/* Backdrop — a soft blur + dim behind the expanded island (chat or
          in-panel voice). Tapping it dismisses the panel.

          The frost lands in ~70ms, NOT on the island's ~280ms spring: measured
          against the real iOS launch animation the blur is ~92% of full
          strength by 68ms, so the scrim is already frosted while the FAB is
          still growing into a panel. See lib/motion-backdrop.ts. */}
      <AnimatePresence>
        {open ? (
          <motion.div
            key="chat-backdrop"
            variants={BACKDROP_BLUR_FADE}
            initial="initial"
            animate="animate"
            exit="exit"
            onClick={() => setOpen(false)}
            aria-hidden
            // See VoiceIsland's backdrop: compositing hint only, so the
            // fullscreen blur rasterizes once instead of every frame.
            style={BACKDROP_BLUR_STYLE}
            className="fixed inset-0 z-30 bg-ink/20 backdrop-blur-md"
          />
        ) : null}
      </AnimatePresence>

      <div className="fixed bottom-24 end-3 z-40 flex items-center gap-2.5">
        {!open ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-pill bg-surface px-3.5 py-2 text-label uppercase text-ink shadow-elevated transition-colors hover:bg-surface-sunken"
          >
            {t('ask', { app: env.appName })}
          </button>
        ) : null}
      <MorphSurface
        state={state}
        shapes={shapes}
        onClick={open ? undefined : () => setOpen(true)}
        role={open ? 'dialog' : 'button'}
        aria-label={
          open ? t('assistant', { app: env.appName }) : t('ask', { app: env.appName })
        }
        className={`shadow-2xl ${open ? '' : 'cursor-pointer ring-2 ring-accent/40'}`}
      >
        {state === 'fab' ? (
          <div className="relative grid h-full w-full place-items-center">
            {/* object-contain, not cover: the mascot is a tall silhouette on a
                transparent field, and cover crops its head off inside the FAB. */}
            <Image
              src={chatbotImg}
              alt=""
              fill
              sizes="50px"
              className="scale-95 object-contain"
              priority
            />
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
  const tLib = useTranslations('lib')
  const tVoice = useTranslations('voice')
  const tChat = useTranslations('chat')
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

  // Wrapped so an unusable mic reports itself — a bare start() leaves the
  // button looking like it simply did nothing.
  const startRecording = async () => {
    const failure = await recorder.start()
    if (failure) toast.error(micFailureMessage(failure, env.appName, tLib))
  }

  const stopAndSend = async () => {
    const blob = await recorder.stop()
    if (!blob) return
    setTranscribing(true)
    try {
      const text = await transcribeAudio(blob)
      if (text.trim()) void ask(text.trim(), timezone)
      else toast.info(tVoice('nothingCaptured'))
    } catch (err) {
      toast.error(translateBackendError(err, tVoice('transcribeFailed')))
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
        <span className="font-display text-heading-serif text-ink">{env.appName}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void clear()}
            aria-label={tChat('clearConversation')}
            className="grid size-7 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={onClose}
            aria-label={tChat('closeAssistant')}
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
          <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-sunken px-3 py-2">
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
              className="ms-auto grid size-9 shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
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
              className="h-10 flex-1 rounded-xl bg-surface-field px-3.5 text-body-sm text-ink outline-none placeholder:text-ink-muted disabled:opacity-60"
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
                onClick={() => void startRecording()}
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
