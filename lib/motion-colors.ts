'use client'

import { useEffect, useState } from 'react'

// Framer-motion interpolates concrete colors, not CSS vars, so the morph
// surfaces (MorphSheet, ChatIsland, the capture flow, IslandHandoff) can't just
// reference bg-surface/bg-canvas — they need a literal to animate toward.
//
// These are READ FROM THE LIVE CUSTOM PROPERTIES rather than restated here. A
// hand-maintained copy of the palette is a copy that goes stale: this file sat
// on the previous theme's plum-charcoal long after globals.css had moved on,
// and every morph sheet in dark mode animated to a colour the design system no
// longer contained. Reading the vars means the morph can never disagree with
// the rest of the app again.
//
// `--accent` (not `--color-accent`) is the accent source: the @theme inline
// mapping means Tailwind inlines --color-accent at build time, so only the
// shadcn-side var exists at runtime.
export interface MorphColors {
  surface: string
  canvas: string
  accent: string
  /** The near-black CTA fill — a morph that grows out of one starts here. */
  solid: string
}

// Used for SSR and the first paint before the DOM can be measured. Matches the
// light token values; next-themes defaults to light until mounted too.
const FALLBACK: MorphColors = {
  surface: 'rgb(255 255 255)',
  canvas: 'rgb(249 248 252)',
  accent: 'rgb(250 106 90)',
  solid: 'rgb(28 26 23)',
}

function readColors(): MorphColors {
  if (typeof document === 'undefined') return FALLBACK
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback
  return {
    surface: read('--color-surface', FALLBACK.surface),
    canvas: read('--color-canvas', FALLBACK.canvas),
    accent: read('--accent', FALLBACK.accent),
    solid: read('--color-solid', FALLBACK.solid),
  }
}

function sameColors(a: MorphColors, b: MorphColors): boolean {
  return a.surface === b.surface && a.canvas === b.canvas && a.accent === b.accent && a.solid === b.solid
}

export function useMorphColors(): MorphColors {
  const [colors, setColors] = useState<MorphColors>(FALLBACK)

  // Re-read whenever <html>'s class actually changes, NOT off next-themes'
  // `resolvedTheme`.
  //
  // Watching the theme value looks equivalent and isn't. next-themes writes the
  // `dark` class from ThemeProvider's own effect, and React runs effects
  // child-first — so every consumer of this hook (all of them are descendants)
  // read the custom properties one commit BEFORE the class landed, and got the
  // theme they were leaving. That is why toggling to dark and opening the chat
  // gave a WHITE panel on a black page, while a refresh looked fine: on a fresh
  // load next-themes' blocking script has already put the class on <html>
  // before any effect runs, so there is nothing to be early for.
  //
  // The attribute is the actual source of truth for what these vars resolve to,
  // so observing it can't be early by construction.
  useEffect(() => {
    const sync = () =>
      // Bails when nothing moved: <html> gets written for reasons that have
      // nothing to do with the palette (scroll locks, and next-themes itself
      // touching `style` on load), and a fresh object every time would rerender
      // every morph surface in the app for none of them.
      setColors((prev) => {
        const next = readColors()
        return sameColors(prev, next) ? prev : next
      })

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    })
    return () => observer.disconnect()
  }, [])

  return colors
}
