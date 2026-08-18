// Browser voice recorder — getUserMedia + a Web Audio capture graph behind a
// small phase machine, plus a live amplitude `level` (0..1) so the UI can react
// to the user's voice in real time. The chat composer and the voice island
// consume `phase`, `elapsedMs`, and `level`. Replaces v1's expo-audio recorder.
//
// stop() resolves with a 16 kHz mono WAV Blob (or null if too short / no data).
//
// Why not MediaRecorder: it encodes to a container that varies by engine
// (webm/opus on Chrome, mp4 on Safari), and the backend's ASR accepts only
// wav/mp3. Decoding that container back to PCM in the browser does not work
// reliably — `decodeAudioData` rejects Chrome's own WebM/Opus output with
// "Unable to decode audio data". Since we already build an audio graph for the
// level meter, we tap it for samples instead: no container, no codec support to
// depend on, and the WAV the server wants falls straight out. See wavEncoder.ts.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'

import { logger } from '@/lib/logger'
import { classifyMicFailure, isMicApiAvailable, type MicFailure } from '@/lib/ai/micFailure'
import { pcmToWav } from '@/lib/ai/wavEncoder'

// 'unavailable' covers every reason start() could not produce a recorder —
// denial is only one of them. Read `failure` for which, and render it with
// micFailureMessage() rather than assuming a permission problem.
export type RecorderPhase = 'idle' | 'requesting' | 'unavailable' | 'recording' | 'stopping'

const MAX_RECORDING_MS = 5 * 60 * 1000
const MIN_CAPTURE_MS = 350

/**
 * ScriptProcessor block size. 4096 frames is ~85ms at 48kHz — large enough that
 * the main-thread callback is infrequent, small enough that stopping feels
 * immediate.
 */
const CAPTURE_BUFFER_SIZE = 4096

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
  /** Resolves with the recording as a WAV Blob, or null if it was too short / silent. */
  stop: () => Promise<Blob | null>
}

export function useVoiceRecorder(): UseVoiceRecorderResult {
  const [phase, setPhase] = useState<RecorderPhase>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const level = useMotionValue(0)
  const [failure, setFailure] = useState<MicFailure | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  /** Captured mono PCM at the context's native rate, one entry per processor block. */
  const chunksRef = useRef<Float32Array[]>([])
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)
  /** True between start() and stop(); the capture callback ignores blocks otherwise. */
  const capturingRef = useRef(false)

  // The capture + analysis graph.
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const visibilityHandlerRef = useRef<(() => void) | null>(null)

  // Bumped by every cleanup. `start()` captures the value before it awaits
  // getUserMedia and re-checks after, so a session torn down mid-permission
  // cannot install its stream into the refs a moment later and leak a live
  // microphone that nothing owns.
  const sessionRef = useRef(0)

  const cleanup = useCallback(() => {
    sessionRef.current += 1
    capturingRef.current = false
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
    if (visibilityHandlerRef.current) {
      document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
      visibilityHandlerRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.onaudioprocess = null
      processorRef.current.disconnect()
      processorRef.current = null
    }
    analyserRef.current = null
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    // Drop the captured audio here, not only in start(). start() resets the
    // buffer AFTER `await getUserMedia`, and bails when a capture is already
    // live — so any stop that did not complete cleanly left the old samples in
    // place and the next recording appended to them.
    chunksRef.current = []
    level.set(0)
    setElapsedMs(0)
  }, [level, setElapsedMs])

  /** Shared by the Stop button and the 5-minute cap. */
  const finish = useCallback((): Blob | null => {
    if (!capturingRef.current) return null
    const durationMs = Date.now() - startedAtRef.current
    const ctx = audioCtxRef.current
    const sampleRate = ctx?.sampleRate ?? 48_000
    const chunks = chunksRef.current
    // Built before cleanup(), which clears the buffer.
    const blob = chunks.length > 0 ? pcmToWav(chunks, sampleRate) : null

    // Peak amplitude over the whole capture. A silent recording is the one
    // failure the server cannot explain — it answers ASR_EMPTY_TRANSCRIPT, which
    // reads as "we could not hear anything" whether the mic was muted, the tab
    // was backgrounded (browsers suspend an AudioContext there, so the processor
    // stops firing while the wall-clock timer keeps counting), or the graph never
    // ran at all. These numbers separate those cases.
    let frames = 0
    let peak = 0
    for (const c of chunks) {
      frames += c.length
      for (let i = 0; i < c.length; i++) {
        const v = c[i] < 0 ? -c[i] : c[i]
        if (v > peak) peak = v
      }
    }
    logger.warn('voiceRecorder:capture', {
      blocks: chunks.length,
      frames,
      seconds: +(frames / sampleRate).toFixed(2),
      peak: +peak.toFixed(4),
      silent: peak < 0.01,
      sampleRate,
      contextState: ctx?.state ?? 'none',
      durationMs,
      wavBytes: blob?.size ?? 0,
    })

    cleanup()
    setPhase('idle')
    setElapsedMs(0)
    return durationMs < MIN_CAPTURE_MS ? null : blob
  }, [cleanup])

  // Kept in a ref so start()'s cap timer calls the current one without making
  // `finish` a dependency of `start` (which would rebuild the callback and, with
  // it, the identity the island's effects depend on).
  const finishRef = useRef(finish)
  useEffect(() => {
    finishRef.current = finish
  }, [finish])

  const start = useCallback(async (): Promise<MicFailure | null> => {
    if (busyRef.current) return null
    // A live capture here means the previous session was never torn down — the
    // panel closed without its stop() completing, say. Returning early left the
    // OLD context running: its interval kept ticking, so reopening the mic showed
    // the previous session's elapsed time climbing (3:44 instead of 0:00) and no
    // new recording ever started. Reclaim it instead of bailing.
    if (capturingRef.current) {
      logger.warn('voiceRecorder:stale-session-reclaimed')
      cleanup()
    }
    busyRef.current = true
    setPhase('requesting')
    setFailure(null)
    try {
      // Checked up front so a missing API reads as 'unsupported' rather than
      // throwing a bare TypeError that looks like a denial further down.
      if (!isMicApiAvailable()) throw new Error('mediaDevices unavailable')
      const session = sessionRef.current
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      // The panel closed while the permission prompt was up. Release the stream
      // we were just handed instead of storing it — nobody is going to ask for
      // it, and an unreleased track keeps the OS microphone indicator lit.
      if (session !== sessionRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return null
      }

      streamRef.current = stream
      chunksRef.current = []

      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      audioCtxRef.current = ctx
      // Chrome starts a context created during a gesture as 'running', but a
      // context created after an await can land 'suspended' — in which case no
      // audio ever reaches the processor and the recording is silent.
      if (ctx.state === 'suspended') await ctx.resume()

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyserRef.current = analyser
      source.connect(analyser)

      // ScriptProcessorNode rather than an AudioWorklet: the worklet needs a
      // module fetched from a separate URL, which a static export bundled into
      // a Capacitor shell makes awkward for no benefit at this clip length.
      const processor = ctx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1)
      processor.onaudioprocess = (event) => {
        if (!capturingRef.current) return
        // copyFromChannel/slice is required — the event buffer is reused for the
        // next block, so keeping the reference would give us N copies of the
        // final block instead of the recording.
        chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      processorRef.current = processor
      source.connect(processor)
      // A ScriptProcessor only runs while connected to the destination. Route it
      // through a silent gain node so the mic is not played back to the user.
      const mute = ctx.createGain()
      mute.gain.value = 0
      processor.connect(mute)
      mute.connect(ctx.destination)

      // Browsers suspend an AudioContext while the tab is hidden, which stops the
      // processor and captures silence for as long as you are away. Nothing can
      // recover that audio, but resuming on return means the rest of the take
      // still records instead of the session being dead from then on.
      const onVisibility = () => {
        if (document.visibilityState === 'visible' && ctx.state === 'suspended') {
          void ctx.resume().catch(() => {})
        }
      }
      document.addEventListener('visibilitychange', onVisibility)
      visibilityHandlerRef.current = onVisibility

      capturingRef.current = true
      startedAtRef.current = Date.now()
      setElapsedMs(0)
      setPhase('recording')
      tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 200)
      capRef.current = setTimeout(() => void finishRef.current(), MAX_RECORDING_MS)

      // Live level meter — RMS of the time-domain signal, smoothed.
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
  }, [cleanup, level])

  // Synchronous underneath, but kept promise-returning: three call sites await
  // it, and the phase machine reads better with the seam left in place.
  const stopInternal = useCallback((): Promise<Blob | null> => {
    if (!capturingRef.current) {
      // NOT a no-op. `start()` holds a live MediaStream from the moment
      // getUserMedia resolves, but only flips `capturing` once the whole graph
      // is built — so between those two points the microphone is open while this
      // flag is still false. Returning early there left the mic running with the
      // panel closed: the OS recording indicator stayed lit, and pressing cancel
      // again just repeated the same no-op, which is why it took several tries
      // to "reset". Nothing else would have collected it either — this hook is
      // mounted for the life of the app, so its unmount cleanup never runs.
      //
      // `cleanup()` is null-guarded throughout, so calling it when genuinely
      // idle costs nothing.
      cleanup()
      setPhase('idle')
      setElapsedMs(0)
      return Promise.resolve(null)
    }
    setPhase('stopping')
    return Promise.resolve(finishRef.current())
  }, [cleanup])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return { phase, elapsedMs, level, failure, start, stop: stopInternal }
}
