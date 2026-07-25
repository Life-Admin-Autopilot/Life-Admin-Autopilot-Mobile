'use client'

import { useTheme } from 'next-themes'

// Framer-motion interpolates concrete colors, not CSS vars, so the morph
// islands (ChatIsland, IslandHandoff, showcase popups) can't just reference
// bg-surface/bg-canvas. This mirrors the light/dark token pairs from
// globals.css so those surfaces still flip with the theme.
const LIGHT = {
  surface: 'rgb(255 255 255)',
  canvas: 'rgb(245 242 251)',
  accent: 'rgb(142 122 224)',
}

const DARK = {
  surface: 'rgb(36 33 48)',
  canvas: 'rgb(23 21 31)',
  accent: 'rgb(168 150 235)',
}

// Falls back to light values until mounted (matches next-themes' own
// hydration-safe default), then tracks the resolved (system-aware) theme.
export function useMorphColors() {
  const { resolvedTheme } = useTheme()
  return resolvedTheme === 'dark' ? DARK : LIGHT
}
