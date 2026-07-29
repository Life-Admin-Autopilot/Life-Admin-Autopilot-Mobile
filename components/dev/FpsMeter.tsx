'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * On-device FPS readout + A/B probe — dev builds only (NEXT_PUBLIC_SHOW_FPS).
 *
 * Exists so framerate can be measured on a real iPhone with NOTHING attached:
 * no Xcode, no Safari Web Inspector. Both perturb what we are measuring — an
 * attached debugger and an inspectable WKWebView slow JS by roughly an order of
 * magnitude, which is how you end up "optimizing" a problem that only exists
 * while you are watching it.
 *
 * TAP THE METER to cycle what is disabled. This isolates the cost of a suspect
 * without a rebuild: run the same interaction in each mode and compare worst
 * frame time. Whichever mode makes the number jump is the culprit.
 *
 * It disables things via attribute selectors against the Tailwind classes that
 * are already in the DOM, so NOTHING in the app's own components changes — this
 * probe is entirely self-contained and cannot leak into a prod build.
 *
 * Renders only when the mode changes; the rAF loop writes to the DOM through a
 * ref. Using setState per frame here would reproduce the exact pathology this
 * was built to find (see lib/ai/useVoiceRecorder.ts).
 */

// Each mode names ONE suspect so the comparison stays clean.
const MODES = [
  { key: 'normal', label: 'all on' },
  { key: 'no-blur', label: 'blur off' },
  { key: 'no-shadow', label: 'shadow off' },
  { key: 'no-blur no-shadow', label: 'blur+shadow off' },
] as const

const PROBE_CSS = `
html[data-perf~="no-blur"] .backdrop-blur-md,
html[data-perf~="no-blur"] .backdrop-blur-xl,
html[data-perf~="no-blur"] .backdrop-blur-sm {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
html[data-perf~="no-shadow"] .shadow-elevated {
  box-shadow: none !important;
}
`

export function FpsMeter() {
  const readoutRef = useRef<HTMLSpanElement>(null)
  const [modeIndex, setModeIndex] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.perf = MODES[modeIndex].key
    return () => {
      delete document.documentElement.dataset.perf
    }
  }, [modeIndex])

  useEffect(() => {
    let frames = 0
    let worstMs = 0
    let last = performance.now()
    let windowStart = last
    let raf = 0

    const loop = (now: number) => {
      const delta = now - last
      last = now
      frames += 1
      if (delta > worstMs) worstMs = delta

      // Twice a second: often enough to watch live, rare enough that the DOM
      // write is not itself part of the measurement.
      const elapsed = now - windowStart
      if (elapsed >= 500) {
        const fps = Math.round((frames * 1000) / elapsed)
        const node = readoutRef.current
        if (node) node.textContent = `${fps}fps worst ${worstMs.toFixed(0)}ms`
        frames = 0
        worstMs = 0
        windowStart = now
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      <style>{PROBE_CSS}</style>
      <button
        type="button"
        onClick={() => setModeIndex((i) => (i + 1) % MODES.length)}
        aria-label="Cycle performance probe mode"
        // Inline styles on purpose: a diagnostic overlay must not depend on
        // design tokens that could change under it.
        style={{
          position: 'fixed',
          left: 8,
          top: 'calc(env(safe-area-inset-top, 0px) + 4px)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 1,
          padding: '3px 7px',
          border: 0,
          borderRadius: 6,
          background: 'rgba(0,0,0,0.72)',
          color: '#fff',
          font: '500 10px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'left',
        }}
      >
        <span ref={readoutRef}>… fps</span>
        <span style={{ opacity: 0.65 }}>{MODES[modeIndex].label}</span>
      </button>
    </>
  )
}
