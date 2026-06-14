'use client'

import { useState } from 'react'
import { X, SendHorizontal } from 'lucide-react'

import { Plus } from '@/components/icons/Plus'
import { MorphSurface, type MorphShape } from '@/components/ui/MorphSurface'

// Motion seam: framer interpolates concrete colors, not CSS vars. These mirror
// --color-accent (crimson) and --color-surface (white) from tokens.md.
const CRIMSON = 'rgb(164 22 26)'
const WHITE = 'rgb(255 255 255)'

const SHAPES: Record<'fab' | 'panel', MorphShape> = {
  fab: { width: 56, height: 56, radius: 28, background: CRIMSON },
  panel: { width: 340, height: 440, radius: 24, background: WHITE },
}

// Chatbot popup — the literal Dynamic Island morph: a crimson cross FAB expands
// into a chat panel and collapses back. Same MorphSurface engine. Mock content
// until the real chat backend is wired.
export function ChatbotPopup() {
  const [open, setOpen] = useState(false)
  const state: 'fab' | 'panel' = open ? 'panel' : 'fab'

  return (
    <MorphSurface
      state={state}
      shapes={SHAPES}
      onClick={open ? undefined : () => setOpen(true)}
      role={open ? 'dialog' : 'button'}
      aria-label={open ? 'Assistant' : 'Open assistant'}
      className={`fixed bottom-24 right-5 z-40 ${open ? '' : 'cursor-pointer'}`}
    >
      {state === 'fab' ? (
        <div className="grid h-full w-full place-items-center">
          <Plus size={24} className="text-accent-ink" />
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="font-display text-heading-md text-ink">Assistant</span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="text-ink-muted transition-colors hover:text-ink"
            >
              <X size={18} />
            </button>
          </header>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-3">
            <Bubble who="system">5 matters require attention. 3 are overdue.</Bubble>
            <Bubble who="user">Renew the car insurance.</Bubble>
            <Bubble who="system">Matter created. Renewal due May 20. Policy attached.</Bubble>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-3">
            <input
              aria-label="Message the assistant"
              placeholder="Speak or type…"
              className="h-9 flex-1 rounded-md bg-surface-sunken px-3 text-body-sm text-ink outline-none placeholder:text-ink-subtle"
            />
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-ink">
              <SendHorizontal size={16} />
            </span>
          </div>
        </div>
      )}
    </MorphSurface>
  )
}

function Bubble({ who, children }: { who: 'system' | 'user'; children: React.ReactNode }) {
  return (
    <div
      className={`max-w-[80%] rounded-lg px-3 py-2 text-body-sm ${
        who === 'user' ? 'self-end bg-accent text-accent-ink' : 'self-start bg-surface-sunken text-ink'
      }`}
    >
      {children}
    </div>
  )
}
