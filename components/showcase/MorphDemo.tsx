'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

import { Plus } from '@/components/icons/Plus'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'

// Live demo of the Wiscord Dynamic Island morph — a pill that expands into a
// card and back, identical physics, marble skin. Stand-in for the real chatbot
// / voice-record popups, which use the same MorphSurface engine.
const SHAPES: Record<'pill' | 'card', MorphShape> = {
  pill: { width: 208, height: 44, radius: 22, paddingX: 6, paddingY: 6 },
  card: { width: 320, height: 188, radius: 26, paddingX: 18, paddingY: 16 },
}

export function MorphDemo() {
  const [open, setOpen] = useState(false)
  const state: 'pill' | 'card' = open ? 'card' : 'pill'

  return (
    <div className="flex min-h-[210px] justify-center pt-1">
      <MorphSurface
        state={state}
        shapes={SHAPES}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
        aria-label={open ? 'Collapse assistant' : 'Expand assistant'}
        className="h-fit cursor-pointer"
      >
        {state === 'pill' ? (
          <div className="flex h-full items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent">
              <Plus size={16} className="text-accent-ink" />
            </span>
            <span className="text-body-sm text-ink">Ask the assistant</span>
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-display text-heading-md text-ink">Assistant</span>
              <X size={18} className="text-ink-muted" />
            </div>
            <p className="text-body-sm text-ink-muted">
              This panel morphed out of the pill with the exact Wiscord Dynamic Island
              spring — identical physics, marble skin.
            </p>
            <span className="mt-auto text-label uppercase text-accent">Tap to collapse</span>
          </div>
        )}
      </MorphSurface>
    </div>
  )
}
