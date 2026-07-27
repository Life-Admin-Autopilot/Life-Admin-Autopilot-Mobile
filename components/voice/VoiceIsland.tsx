'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { Mic, X, Square, Check } from 'lucide-react'

import { AssistantText } from '@/components/chat/AssistantText'
import { askStream } from '@/lib/ai/stream'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { useVoiceCapture } from '@/lib/voice/captureStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { MORPH_BACKDROP_FADE, MORPH_SPRING } from '@/lib/motion'
import { isAppChatRoute } from '@/lib/appRoutes'
import type { AiSource } from '@/lib/ai/types'
import { env } from '@/lib/env'

type Phase = 'recording' | 'review' | 'transcribing' | 'thinking' | 'done' | 'error'

// Voice capture — the bridge to the assistant by voice. Opened from the TabBar mic, it
// rises from the bar into an ~80% surface with a live, voice-reactive meter. The
// user can cancel, stop, then save: saving transcribes the audio and streams it
// to the assistant, which records the matters and replies.
export function VoiceIsland() {
  const open = useVoiceCapture((s) => s.open)
  const close = useVoiceCapture((s) => s.close)
  const pathname = usePathname()
  const recorder = useVoiceRecorder()
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])

  const [phase, setPhase] = useState<Phase>('recording')
  const [capturedMs, setCapturedMs] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [transcript, setTranscript] = useState('')
  const [reply, setReply] = useState('')
  const [sources, setSources] = useState<AiSource[]>([])
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const [vp] = useState(() => ({
    w: typeof window === 'undefined' ? 400 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  const panelW = Math.min(vp.w * 0.92, 440)
  const panelH = vp.h * 0.8

  // Start recording the moment the surface opens; reset everything on close.
  useEffect(() => {
    if (open) {
      setPhase('recording')
      setBlob(null)
      setTranscript('')
      setReply('')
      setSources([])
      setError(null)
      void recorder.start()
    } else {
      abortRef.current?.abort()
      void recorder.stop().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The mic only opens from the TabBar, which the auth screens don't render —
  // but a sign-out mid-capture would otherwise strand an open, still-recording
  // surface over /welcome. Closing routes through the effect above, so the
  // recorder and the in-flight stream are torn down properly.
  useEffect(() => {
    if (open && !isAppChatRoute(pathname)) close()
  }, [open, pathname, close])

  // Surface a denied mic instead of a dead recording state.
  useEffect(() => {
    if (open && recorder.phase === 'denied') {
      setError(`Microphone access is blocked. Enable it to speak to ${env.appName}.`)
      setPhase('error')
    }
  }, [open, recorder.phase])

  const cancel = async () => {
    abortRef.current?.abort()
    await recorder.stop().catch(() => {})
    close()
  }

  const stop = async () => {
    setCapturedMs(recorder.elapsedMs)
    const b = await recorder.stop()
    if (!b) {
      toast.info('Too short — nothing captured.')
      close()
      return
    }
    setBlob(b)
    setPhase('review')
  }

  const askPanda = async (text: string) => {
    setPhase('thinking')
    setReply('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      for await (const ev of askStream({ question: text, timezone, signal: controller.signal })) {
        if (ev.type === 'token') setReply((r) => r + ev.text)
        else if (ev.type === 'sources') setSources((prev) => [...prev, ...ev.sources])
        else if (ev.type === 'error') {
          setError(ev.message)
          setPhase('error')
          return
        }
      }
      setPhase('done')
    } catch (err) {
      if (controller.signal.aborted) return
      setError(translateBackendError(err, `${env.appName} could not be reached.`))
      setPhase('error')
    }
  }

  const save = async () => {
    if (!blob) return
    setPhase('transcribing')
    try {
      const text = await transcribeAudio(blob)
      if (!text.trim()) {
        toast.info('Nothing was captured.')
        close()
        return
      }
      setTranscript(text)
      await askPanda(text)
    } catch (err) {
      setError(translateBackendError(err, 'Could not transcribe that.'))
      setPhase('error')
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="voice-backdrop"
          variants={MORPH_BACKDROP_FADE}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={cancel}
          aria-hidden
          className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-md"
        />
      ) : null}
      {open ? (
        <motion.div
          key="voice-panel"
          role="dialog"
          aria-label={`Speak to ${env.appName}`}
          initial={{ width: 56, height: 56, opacity: 0.4 }}
          animate={{ width: panelW, height: panelH, opacity: 1 }}
          exit={{ width: 56, height: 56, opacity: 0 }}
          transition={MORPH_SPRING}
          style={{ transformOrigin: 'bottom center' }}
          className="bottom-safe fixed left-1/2 z-50 -translate-x-1/2 overflow-hidden rounded-3xl bg-surface shadow-elevated"
        >
          <div className="flex h-full w-full flex-col items-center justify-between p-6 text-center">
              <Header phase={phase} />

              <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
                {phase === 'recording' || phase === 'review' ? (
                  <>
                    <Pulse level={phase === 'recording' ? recorder.level : 0} active={phase === 'recording'} />
                    <span className="tabular text-display-md text-ink">
                      {formatElapsed(phase === 'recording' ? recorder.elapsedMs : capturedMs)}
                    </span>
                  </>
                ) : phase === 'transcribing' ? (
                  <p className="text-body text-ink-muted">Transcribing…</p>
                ) : phase === 'thinking' || phase === 'done' ? (
                  <div className="w-full overflow-y-auto">
                    {transcript ? (
                      <p className="mb-3 text-body-sm italic text-ink-subtle">“{transcript}”</p>
                    ) : null}
                    {reply ? (
                      <AssistantText text={reply} sources={sources} streaming={phase === 'thinking'} />
                    ) : (
                      <p className="text-body text-ink-muted">{env.appName} is recording your matters…</p>
                    )}
                  </div>
                ) : (
                  <p className="text-body text-danger">{error}</p>
                )}
              </div>

              <Controls
                phase={phase}
                onCancel={cancel}
                onStop={() => void stop()}
                onSave={() => void save()}
                onDone={close}
              />
            </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function Header({ phase }: { phase: Phase }) {
  const label =
    phase === 'recording'
      ? 'Listening'
      : phase === 'review'
        ? 'Ready to send'
        : phase === 'transcribing'
          ? 'Transcribing'
          : phase === 'thinking'
            ? `${env.appName} responds`
            : phase === 'done'
              ? 'Order follows'
              : 'Something went wrong'
  return <span className="text-label uppercase tracking-wide text-accent">{label}</span>
}

// A purple disc that scales with the live mic level — the voice made visible.
function Pulse({ level, active }: { level: number; active: boolean }) {
  const scale = active ? 1 + level * 0.9 : 1
  return (
    <div className="relative grid size-40 place-items-center">
      <div
        className="absolute size-28 rounded-full bg-accent/15 transition-transform duration-75"
        style={{ transform: `scale(${1 + level * 1.4})` }}
      />
      <div
        className="absolute size-24 rounded-full bg-accent/25 transition-transform duration-75"
        style={{ transform: `scale(${scale})` }}
      />
      <div className="relative grid size-20 place-items-center rounded-full bg-accent text-accent-ink">
        <Mic size={28} />
      </div>
    </div>
  )
}

function Controls({
  phase,
  onCancel,
  onStop,
  onSave,
  onDone,
}: {
  phase: Phase
  onCancel: () => void
  onStop: () => void
  onSave: () => void
  onDone: () => void
}) {
  if (phase === 'recording') {
    return (
      <div className="flex items-center gap-4">
        <CircleButton label="Cancel" onClick={onCancel} variant="ghost">
          <X size={22} />
        </CircleButton>
        <CircleButton label="Stop" onClick={onStop} variant="accent">
          <Square size={20} fill="currentColor" />
        </CircleButton>
      </div>
    )
  }
  if (phase === 'review') {
    return (
      <div className="flex items-center gap-4">
        <CircleButton label="Discard" onClick={onCancel} variant="ghost">
          <X size={22} />
        </CircleButton>
        <CircleButton label="Save" onClick={onSave} variant="accent">
          <Check size={24} />
        </CircleButton>
      </div>
    )
  }
  if (phase === 'done' || phase === 'error') {
    return (
      <button
        onClick={onDone}
        className="rounded-pill bg-accent px-6 py-2.5 text-body-sm font-medium text-accent-ink"
      >
        Done
      </button>
    )
  }
  // transcribing / thinking — no controls (in flight).
  return <div className="h-12" />
}

function CircleButton({
  label,
  onClick,
  variant,
  children,
}: {
  label: string
  onClick: () => void
  variant: 'ghost' | 'accent'
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`grid size-14 place-items-center rounded-full shadow-elevated transition-colors ${
        variant === 'accent'
          ? 'bg-accent text-accent-ink hover:bg-accent-pressed'
          : 'bg-surface-field text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
