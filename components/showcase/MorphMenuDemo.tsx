'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

import { MorphPanel } from '@/components/ui/MorphPanel'

// Dropdown built on the morph engine — the menu drops out of the trigger with
// the Wiscord spring and content fade. Outside-click + Escape close it.
// (Production would layer Radix DropdownMenu for full focus management; the
// morph + a11y basics are shown here.)
const ITEMS = ['Due date', 'Domain', 'Recently added', 'Priority'] as const
const ROW_H = 40
const PAD_Y = 8
const WIDTH = 224

export function MorphMenuDemo() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<(typeof ITEMS)[number]>('Due date')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const height = ITEMS.length * ROW_H + PAD_Y * 2

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-4 text-body-sm text-ink shadow-card"
      >
        Sort <span className="text-ink-muted">· {selected}</span>
        <ChevronDown
          size={16}
          className={`text-ink-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <div className="absolute left-0 top-full z-30 mt-2">
        <MorphPanel open={open} width={WIDTH} height={height} radius={14}>
          <ul role="menu" className="flex flex-col p-2" style={{ width: WIDTH }}>
            {ITEMS.map((item) => (
              <li key={item} role="none">
                <button
                  role="menuitemradio"
                  aria-checked={selected === item}
                  onClick={() => {
                    setSelected(item)
                    setOpen(false)
                  }}
                  style={{ height: ROW_H }}
                  className="flex w-full items-center justify-between rounded-md px-3 text-body-sm text-ink transition-colors hover:bg-surface-sunken"
                >
                  {item}
                  {selected === item ? <Check size={16} className="text-accent" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </MorphPanel>
      </div>
    </div>
  )
}
