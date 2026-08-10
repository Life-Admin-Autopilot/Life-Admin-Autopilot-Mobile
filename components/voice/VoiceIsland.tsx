'use client'

import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, type MotionValue } from 'framer-motion'
import { Mic, X, Square, Check } from 'lucide-react'

import { AssistantText } from '@/components/chat/AssistantText'
import { askStream } from '@/lib/ai/stream'
import { transcribeAudio } from '@/lib/ai/transcribe'
import { useVoiceRecorder } from '@/lib/ai/useVoiceRecorder'
import { micFailureMessage } from '@/lib/ai/micFailure'
import { useVoiceCapture } from '@/lib/voice/captureStore'
import { toast } from '@/lib/toast'
import { translateBackendError } from '@/lib/translateBackendError'
import { BACKDROP_BLUR_FADE, BACKDROP_BLUR_STYLE } from '@/lib/motion-backdrop'
import { MORPH_SPRING } from '@/lib/motion'
import { springToLinearEasing } from '@/lib/springEasing'
import { isAppChatRoute } from '@/lib/appRoutes'
import type { AiSource } from '@/lib/ai/types'
import { env } from '@/lib/env'

/**
 * Safety net for the deferred mic start. Comfortably past the ~360ms morph, so
 * it only fires when onAnimationComplete does not — never racing it.
 */
const MIC_START_FALLBACK_MS = 600

/**
 * MORPH_SPRING as a CSS `linear()` easing, computed once at module load.
 *
 * Lets the open animation run off the CSS timeline instead of framer's JS spring
 * integration. framer drives springs from requestAnimationFrame, which WebKit
 * caps at 60Hz inside WKWebView; CSS is not rAF-bound and does no per-frame JS.
 * Same physics, same absolute-time curve — see lib/springEasing.ts.
 */
const MORPH_CSS = springToLinearEasing({ stiffness: 240, damping: 30, mass: 0.9 })

type Phase = 'recording' | 'review' | 'transcribing' | 'thinking' | 'done' | 'error'

// Voice capture — the bridge to the assistant by voice. Opened from the TabBar mic, it
// rises from the bar into an ~80% surface with a live, voice-reactive meter. The
// user can cancel, stop, then save: saving transcribes the audio and streams it
// to the assistant, which records the matters and replies.
export function VoiceIsland() {
  const t = useTranslations('voice')
  const tLib = useTranslations('lib')
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

  // CSS-morph path (probe mode) — declared before the open effect that latches
  // it, so the setter is initialised by the time that effect closes over it.
  const [cssMorph, setCssMorph] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const [vp] = useState(() => ({
    w: typeof window === 'undefined' ? 400 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }))
  const panelW = Math.min(vp.w * 0.92, 440)
  const panelH = vp.h * 0.8

  // Reset on open; tear down on close. Note what is NOT here: recorder.start().
  //
  // Starting the mic on this commit put getUserMedia — which activates an
  // AVAudioSession, a 100–300ms main-thread stall on iOS — plus `new
  // AudioContext()` and a fresh rAF loop onto the exact frames the open spring
  // needs. The animation and the audio hardware fought, and the open measured
  // ~40fps. The mic now starts once the shell has settled (see below).
  useEffect(() => {
    if (open) {
      // Latched at open time: switching probe modes requires reopening the
      // panel to see the effect anyway, so there is nothing to gain from
      // making this reactive mid-animation.
      setCssMorph(document.documentElement.dataset.perf?.includes('css-morph') ?? false)
      setPhase('recording')
      setBlob(null)
      setTranscript('')
      setReply('')
      setSources([])
      setError(null)
    } else {
      abortRef.current?.abort()
      void recorder.stop().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Hand the mic the frame AFTER the morph is done, so the audio-session stall
  // lands on an idle main thread instead of mid-spring.
  //
  // Fires from the panel's onAnimationComplete, with a timer as the safety net
  // for the cases framer will not call it (an interrupted or skipped
  // animation) — a missed callback here would mean a surface that says
  // "Recording" and never records.
  const micStartedRef = useRef(false)

  useEffect(() => {
    if (!open || !cssMorph) return
    // One painted frame at the start size, so the CSS transition has something
    // to transition FROM. framer does the same internally for its `initial`.
    const raf = requestAnimationFrame(() => setExpanded(true))
    return () => {
      cancelAnimationFrame(raf)
      setExpanded(false)
    }
  }, [open, cssMorph])

  const startMic = useCallback(() => {
    if (micStartedRef.current || !open) return
    micStartedRef.current = true
    void recorder.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) {
      micStartedRef.current = false
      return
    }
    const fallback = setTimeout(startMic, MIC_START_FALLBACK_MS)
    return () => clearTimeout(fallback)
  }, [open, startMic])

  // The mic only opens from the TabBar, which the auth screens don't render —
  // but a sign-out mid-capture would otherwise strand an open, still-recording
  // surface over /welcome. Closing routes through the effect above, so the
  // recorder and the in-flight stream are torn down properly.
  useEffect(() => {
    if (open && !isAppChatRoute(pathname)) close()
  }, [open, pathname, close])

  // Surface an unusable mic instead of a dead recording state. The reason
  // matters: a blocked permission and a non-secure dev origin both land here,
  // and only one of them is fixable in Settings.
  useEffect(() => {
    if (open && recorder.phase === 'unavailable') {
      setError(micFailureMessage(recorder.failure ?? 'unknown', env.appName, tLib))
      setPhase('error')
    }
  }, [open, recorder.phase, recorder.failure])

  const cancel = async () => {
    abortRef.current?.abort()
    await recorder.stop().catch(() => {})
    close()
  }

  const stop = async () => {
    setCapturedMs(recorder.elapsedMs)
    const b = await recorder.stop()
    if (!b) {
      toast.info(t('tooShort'))
      close()
      return
    }
    setBlob(b)
    setPhase('review')
  }

  const askKitto = async (text: string) => {
    setPhase('thinking')
    setReply('')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      // 'transcript', not 'chat': this text is a raw dictation the user never
      // read back, so the agent parses it for intent rather than answering it as
      // a typed message.
      for await (const ev of askStream({
        question: text,
        timezone,
        mode: 'transcript',
        signal: controller.signal,
      })) {
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
        toast.info(t('nothingCaptured'))
        close()
        return
      }
      setTranscript(text)
      await askKitto(text)
    } catch (err) {
      setError(translateBackendError(err, t('transcribeFailed')))
      setPhase('error')
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="voice-backdrop"
          // Frost on its own ~70ms track while the panel keeps MORPH_SPRING —
          // the measured iOS launch reaches ~92% blur strength by 68ms, four
          // times faster than the geometry. See lib/motion-backdrop.ts.
          variants={BACKDROP_BLUR_FADE}
          initial="initial"
          animate="animate"
          exit="exit"
          onClick={cancel}
          aria-hidden
          // willChange promotes the blur to its own layer so WebKit rasterizes
          // it ONCE and animates opacity on the cached bitmap. Without it the
          // fullscreen backdrop-filter is re-sampled every frame the island
          // moves above it — the single most expensive thing on this screen.
          // Blur radius and color are unchanged; this is a compositing hint only.
          style={BACKDROP_BLUR_STYLE}
          className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-md"
        />
      ) : null}
      {open ? (
        <motion.div
          key="voice-panel"
          role="dialog"
          aria-label={`Speak to ${env.appName}`}
          // In CSS-morph mode framer handles ONLY opacity (which it already
          // hardware-accelerates); width/height move to a CSS transition below,
          // off the rAF clock entirely.
          initial={cssMorph ? { opacity: 0.4 } : { width: 56, height: 56, opacity: 0.4 }}
          animate={cssMorph ? { opacity: 1 } : { width: panelW, height: panelH, opacity: 1 }}
          exit={cssMorph ? { opacity: 0 } : { width: 56, height: 56, opacity: 0 }}
          transition={MORPH_SPRING}
          onAnimationComplete={startMic}
          style={
            cssMorph
              ? {
                  transformOrigin: 'bottom center',
                  width: expanded ? panelW : 56,
                  height: expanded ? panelH : 56,
                  transition: `width ${MORPH_CSS.durationMs}ms ${MORPH_CSS.easing}, height ${MORPH_CSS.durationMs}ms ${MORPH_CSS.easing}`,
                }
              : { transformOrigin: 'bottom center' }
          }
          className="bottom-safe fixed left-1/2 z-50 -translate-x-1/2 overflow-hidden rounded-3xl bg-surface shadow-elevated"
        >
          <div className="flex h-full w-full flex-col items-center justify-between p-6 text-center">
              <Header phase={phase} />

              <div className="flex w-full flex-1 flex-col items-center justify-center gap-6">
                {phase === 'recording' || phase === 'review' ? (
                  <>
                    <Pulse level={recorder.level} active={phase === 'recording'} />
                    <span className="tabular text-display-md text-ink">
                      {formatElapsed(phase === 'recording' ? recorder.elapsedMs : capturedMs)}
                    </span>
                  </>
                ) : phase === 'transcribing' ? (
                  <p className="text-body text-ink-muted">{t('transcribingEllipsis')}</p>
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
  const t = useTranslations('voice')
  const label =
    phase === 'recording'
      ? t('listening')
      : phase === 'review'
        ? t('readyToSend')
        : phase === 'transcribing'
          ? t('transcribing')
          : phase === 'thinking'
            ? t('responds', { app: env.appName })
            : phase === 'done'
              ? t('orderFollows')
              : t('somethingWrong')
  return <span className="text-label uppercase tracking-wide text-accent">{label}</span>
}

// A purple disc that scales with the live mic level — the voice made visible.
/**
 * Mic level rings.
 *
 * Subscribes to the level MotionValue and writes `transform` straight to the
 * two ring nodes — byte-identical to the strings the previous render-driven
 * version produced, and the `transition-transform duration-75` classes are
 * unchanged, so the smoothing is the same. The only thing that changed is that
 * a new level no longer re-renders this component (or its parent).
 */
function Pulse({ level, active }: { level: MotionValue<number>; active: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const apply = (raw: number) => {
      // Matches the old parent-side `phase === 'recording' ? level : 0` gate.
      const l = active ? raw : 0
      if (outerRef.current) outerRef.current.style.transform = `scale(${1 + l * 1.4})`
      if (innerRef.current) innerRef.current.style.transform = `scale(${1 + l * 0.9})`
    }
    apply(level.get())
    return level.on('change', apply)
  }, [level, active])

  return (
    <div className="relative grid size-40 place-items-center">
      <div
        ref={outerRef}
        className="absolute size-28 rounded-full bg-accent/15 transition-transform duration-75"
      />
      <div
        ref={innerRef}
        className="absolute size-24 rounded-full bg-accent/25 transition-transform duration-75"
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
