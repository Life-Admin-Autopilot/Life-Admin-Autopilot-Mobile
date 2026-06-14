'use client'

import { useState } from 'react'
import { Mic, Square } from 'lucide-react'

import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'

// Mirrors --color-accent (crimson) / --color-surface (white) — see tokens.md.
const CRIMSON = 'rgb(164 22 26)'
const WHITE = 'rgb(255 255 255)'

const SHAPES: Record<'idle' | 'recording', MorphShape> = {
  idle: { width: 56, height: 56, radius: 28, background: CRIMSON },
  recording: { width: 264, height: 88, radius: 24, background: WHITE, paddingX: 16, paddingY: 14 },
}

// Voice-record popup — a crimson mic FAB morphs into a recording panel (calm
// level meter + timer + stop) and back. Same MorphSurface engine; capture is
// foreground-started (AGENTS.md → Capacitor). Mock until lib/voice is wired.
export function VoiceRecordPopup() {
  const [rec, setRec] = useState(false)
  const state: 'idle' | 'recording' = rec ? 'recording' : 'idle'

  return (
    <MorphSurface
      state={state}
      shapes={SHAPES}
      onClick={rec ? undefined : () => setRec(true)}
      role="button"
      aria-label={rec ? 'Recording' : 'Start voice capture'}
      className={`fixed bottom-24 left-5 z-40 ${rec ? '' : 'cursor-pointer'}`}
    >
      {state === 'idle' ? (
        <div className="grid h-full w-full place-items-center">
          <Mic size={22} className="text-accent-ink" />
        </div>
      ) : (
        <div className="flex h-full items-center gap-3">
          <Meter />
          <span className="text-heading-sm tabular text-ink">0:03</span>
          <button
            onClick={() => setRec(false)}
            aria-label="Stop recording"
            className="ml-auto grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink"
          >
            <Square size={13} fill="currentColor" />
          </button>
        </div>
      )}
    </MorphSurface>
  )
}

// Calm crimson level bars — static heights (no bouncing spectacle), per the
// restrained motion philosophy.
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
