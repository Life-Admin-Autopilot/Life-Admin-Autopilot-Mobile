'use client'

import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { MORPH_BACKDROP_FADE, MORPH_CONTENT_VARIANTS, MORPH_SPRING } from '@/lib/motion'
import { useMorphColors } from '@/lib/motion-colors'

// The Matters sheets — filter, arrange, matter detail, delete confirm.
//
// Same Dynamic Island morph as the document capture flow: the surface grows out
// of the control that opened it (its DOMRect) into a bottom sheet, and collapses
// back into it on dismiss. Physics come from lib/motion.ts — do NOT retune.
//
// Two things this does that a plain bottom sheet did not:
//
//   1. `fixed`, not `absolute`. PhoneFrame's `transform-gpu` makes fixed
//      descendants resolve against the phone shell, so the sheet stays pinned to
//      the device viewport. `absolute` resolved against the scrolling page, which
//      is why the sheet drifted up the screen as the list scrolled.
//
//   2. Measures the fixed containing block instead of trusting
//      `window.innerHeight`. Inside PhoneFrame those differ — the window is the
//      browser, the containing block is the 410×864 phone — so a sheet placed
//      from window height lands off-device on desktop. An always-mounted
//      `fixed inset-0` probe reports the real box, on both mobile and desktop.

const SHEET_MARGIN = 16
const SHEET_RADIUS = 26
const SHEET_MAX_WIDTH = 440
const TRIGGER_RADIUS = 16

export interface Viewport {
  width: number
  height: number
  top: number
  left: number
}

export function MorphSheet({
  open,
  onClose,
  title,
  eyebrow,
  trigger,
  height = 420,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  /** Rect of the control that opened this, in viewport coordinates. */
  trigger?: DOMRect | null
  height?: number
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const reduced = useReducedMotion()
  const { surface } = useMorphColors()
  const [vp, setVp] = useState<Viewport | null>(null)
  const probeRef = useRef<HTMLDivElement | null>(null)

  const read = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const r = node.getBoundingClientRect()
    setVp({ width: r.width, height: r.height, top: r.top, left: r.left })
  }, [])

  // Ref callback rather than an effect: it fires during commit, so the probe is
  // measured before anything needs it — and the probe stays mounted while the
  // sheet is closed, so `vp` is already known the instant `open` flips.
  const measure = useCallback(
    (node: HTMLDivElement | null) => {
      probeRef.current = node
      read(node)
    },
    [read],
  )

  useEffect(() => {
    const onResize = () => read(probeRef.current)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [read])

  useEffect(() => {
    if (!open) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const width = vp ? Math.min(vp.width - SHEET_MARGIN * 2, SHEET_MAX_WIDTH) : 0
  // Never taller than the device can show, and never overlapping the notch.
  const sheetHeight = vp ? Math.min(height, vp.height - 72) : height

  const target = vp
    ? {
        top: vp.height - sheetHeight - SHEET_MARGIN,
        left: (vp.width - width) / 2,
        width,
        height: sheetHeight,
        borderRadius: SHEET_RADIUS,
      }
    : null

  // The trigger's rect is in viewport coordinates; the sheet is positioned
  // against the containing block, so subtract the probe's own offset. Falling
  // back to a sliver at the sheet's bottom edge keeps the morph sensible when
  // no trigger was captured (keyboard activation, programmatic open).
  const origin =
    vp && target
      ? trigger
        ? {
            top: trigger.top - vp.top,
            left: trigger.left - vp.left,
            width: trigger.width,
            height: trigger.height,
            borderRadius: TRIGGER_RADIUS,
          }
        : {
            top: target.top + target.height - 8,
            left: target.left + target.width / 2 - 40,
            width: 80,
            height: 8,
            borderRadius: TRIGGER_RADIUS,
          }
      : null

  return (
    <>
      {/* Reports the real fixed-positioning box — the phone shell on desktop,
          the browser viewport on mobile. Each sheet owns its own probe; they
          are inert and identically sized, so having several costs nothing. */}
      <div ref={measure} aria-hidden className="pointer-events-none fixed inset-0 -z-50" />

      {/* Default (sync) presence, deliberately NOT mode="wait": a collapsing
          sheet must never hold up the next one. The outgoing shell finishes its
          own exit while the incoming sheet is already growing out of whatever
          was just tapped. */}
      <AnimatePresence>
        {open && target && origin ? (
          <Surface
            key="sheet-surface"
            target={target}
            origin={origin}
            surface={surface}
            reduced={Boolean(reduced)}
            title={title}
            eyebrow={eyebrow}
            onClose={onClose}
            footer={footer}
          >
            {children}
          </Surface>
        ) : null}
      </AnimatePresence>
    </>
  )
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
  borderRadius: number
}

// Backdrop + shell live together in one presence child so both can read
// `useIsPresent`, which goes false on the frame a dismissal starts rather than
// when the spring settles.
//
// That's the whole reason this is a component and not two inline children: an
// exiting sheet is still a full-screen backdrop and a shrinking shell, and until
// they go click-through they swallow every tap for the length of the collapse —
// which is what made opening another matter feel like it required waiting out
// the animation. Nothing about a sheet on its way out should be interactive.
function Surface({
  target,
  origin,
  surface,
  reduced,
  title,
  eyebrow,
  onClose,
  footer,
  children,
}: {
  target: Rect
  origin: Rect
  surface: string
  reduced: boolean
  title: string
  eyebrow?: string
  onClose: () => void
  footer?: React.ReactNode
  children: React.ReactNode
}) {
  const isPresent = useIsPresent()

  return (
    <>
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        variants={MORPH_BACKDROP_FADE}
        initial="initial"
        animate="animate"
        exit="exit"
        className={cn(
          'fixed inset-0 z-40 bg-ink/30 backdrop-blur-md',
          !isPresent && 'pointer-events-none',
        )}
      />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ ...origin, backgroundColor: surface, opacity: 0.6 }}
        animate={{ ...target, backgroundColor: surface, opacity: 1 }}
        // Collapse back toward the trigger while fading, so the sheet
        // reads as receding rather than a plane sweeping off-screen.
        exit={{ ...origin, opacity: 0 }}
        transition={reduced ? { duration: 0 } : MORPH_SPRING}
        className={cn(
          'fixed z-50 overflow-hidden border border-border shadow-elevated',
          !isPresent && 'pointer-events-none',
        )}
      >
        <motion.div
          variants={MORPH_CONTENT_VARIANTS}
          initial={reduced ? false : 'initial'}
          animate="animate"
          exit="exit"
          className="flex h-full w-full flex-col p-5"
        >
          <div className="flex shrink-0 items-start justify-between gap-2 pb-2">
            <div className="min-w-0">
              {eyebrow ? <span className="text-label uppercase text-accent">{eyebrow}</span> : null}
              <h2 className="font-display text-heading-md text-ink">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 shrink-0 rounded-full p-1.5 text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <X size={18} />
            </button>
          </div>

          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">{children}</div>

          {footer ? <div className="shrink-0 border-t border-border pt-3">{footer}</div> : null}
        </motion.div>
      </motion.div>
    </>
  )
}

// Kept as the public name so callers read naturally; the morph is the only
// sheet behaviour in the app.
export { MorphSheet as Sheet }

// The filter/sort chip used across every sheet — the same shape the scan review
// flow already uses, so selection reads identically app-wide.
export function ChipToggle({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'rounded-pill border px-2.5 py-1 text-caption transition-colors',
        selected
          ? 'border-accent bg-accent/10 text-ink'
          : 'border-border bg-surface text-ink-muted hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  )
}

export function SheetSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 py-2.5">
      <span className="text-label uppercase text-ink-subtle">{label}</span>
      {children}
    </div>
  )
}
