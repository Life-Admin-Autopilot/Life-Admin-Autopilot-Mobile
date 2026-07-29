// Browser voice recorder — wraps MediaRecorder + getUserMedia behind a small
// phase machine, plus a live amplitude `level` (0..1) from a Web Audio analyser
// so the UI can react to the user's voice in real time. The chat composer and
// the voice island consume `phase`, `elapsedMs`, and `level`; neither touches
// MediaRecorder directly. Replaces v1's expo-audio recorder.
//
// stop() resolves with the recorded Blob (or null if too short / no data). The
// Blob's MIME varies by engine (webm/opus on Chrome, mp4 on Safari); the
// transcribe seam sends it as application/octet-stream and lets Gemini sniff it.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'

import { logger } from '@/lib/logger'
import { classifyMicFailure, isMicApiAvailable, type MicFailure } from '@/lib/ai/micFailure'

// 'unavailable' covers every reason start() could not produce a recorder —
// denial is only one of them. Read `failure` for which, and render it with
// micFailureMessage() rather than assuming a permission problem.
export type RecorderPhase = 'idle' | 'requesting' | 'unavailable' | 'recording' | 'stopping'

const MAX_RECORDING_MS = 5 * 60 * 1000
const MIN_CAPTURE_MS = 350

interface UseVoiceRecorderResult {
  phase: RecorderPhase
  elapsedMs: number
  /**
   * Live mic amplitude, 0 (silence) → 1 (loud). 0 when not recording.
   *
   * A MotionValue, NOT React state, because it updates on every animation
   * frame. As `useState` this re-rendered the whole VoiceIsland subtree —
   * shell, transcript, AssistantText, Controls — 60 times a second, which
   * measured as a sustained drop to ~40fps during recording. MotionValue
   * updates bypass React entirely; subscribers write to the DOM directly.
   */
  level: MotionValue<number>
  /** Why the last start() failed. Set whenever phase is 'unavailable'. */
  failure: MicFailure | null
  /** Resolves null once recording, or the reason it could not start. */
  start: () => Promise<MicFailure | null>
  /** Resolves with the recording, or null if it was too short / produced no data. */
  stop: () => Promise<Blob | null>
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const level = useMotionValue(0)
  const [failure, setFailure] = useState<MicFailure | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)

  // Web Audio analyser for the live level meter.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (capRef.current) {
      clearTimeout(capRef.current)
      capRef.current = null
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    analyserRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    level.set(0)
  }, [level])

  const start = useCallback(async (): Promise<MicFailure | null> => {
    if (busyRef.current || recorderRef.current) return null
    busyRef.current = true
    setPhase('requesting')
    setFailure(null)
    try {
      // Checked up front so a missing API reads as 'unsupported' rather than
      // throwing a bare TypeError that looks like a denial further down.
      if (!isMicApiAvailable()) throw new Error('mediaDevices unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setPhase('recording')
      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
      capRef.current = setTimeout(() => void stopInternal(), MAX_RECORDING_MS)

      // Live level meter — RMS of the time-domain signal, smoothed.
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new Ctx()
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        audioCtxRef.current = ctx
        analyserRef.current = analyser
        const buf = new Uint8Array(analyser.frequencyBinCount)
        let smoothed = 0
        const loop = () => {
          const a = analyserRef.current
          if (!a) return
          a.getByteTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128
            sum += v * v
          }
          const rms = Math.sqrt(sum / buf.length)
          // Normalize: speech RMS ~0.05–0.3 → scale up and clamp, then smooth.
          const norm = Math.min(1, rms * 3.2)
          smoothed = smoothed * 0.6 + norm * 0.4
          // .set() — NOT setState. Same value, same cadence, zero re-renders.
          level.set(smoothed)
          rafRef.current = requestAnimationFrame(loop)
        }
        rafRef.current = requestAnimationFrame(loop)
      } catch (err) {
        // Analyser is best-effort — recording still works without the meter.
        logger.warn('voiceRecorder:analyser-failed', err)
      }
    } catch (err) {
      const reason = classifyMicFailure(err)
      logger.warn('voiceRecorder:start-failed', { reason, err })
      cleanup()
      setFailure(reason)
      setPhase('unavailable')
      return reason
    } finally {
      busyRef.current = false
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup])

  const stopInternal = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current
    if (!recorder) return Promise.resolve(null)
    setPhase('stopping')
    const durationMs = Date.now() - startedAtRef.current
    return new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const blob = chunksRef.current.length > 0 ? new Blob(chunksRef.current, { type }) : null
        cleanup()
        setPhase('idle')
        setElapsedMs(0)
        resolve(durationMs < MIN_CAPTURE_MS ? null : blob)
      }
      recorder.stop()
    })
  }, [cleanup])

  useEffect(() => cleanup, [cleanup])

  return { phase, elapsedMs, level, failure, start, stop: stopInternal }
}
