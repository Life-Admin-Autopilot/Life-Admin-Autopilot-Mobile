'use client'

import { useSyncExternalStore } from 'react'

// The wall clock, as a React-readable external store.
//
// Relative labels ("2 hours ago") need the current time, and reading Date.now()
// during render is an impure read of a mutable source — exactly what
// useSyncExternalStore exists for. Reading it through the store also means one
// shared timer for every subscriber instead of one per component.
//
// The server snapshot is null on purpose: this app prerenders to static HTML at
// build time, so a real timestamp baked into the markup would be hours or days
// stale by the time it hydrates, and the mismatch would be a visible flicker.
// Callers render the label only once they have a number.

const TICK_MS = 60_000

let cached: number | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (timer === null) {
    timer = setInterval(() => {
      cached = Date.now()
      for (const listener of listeners) listener()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): number {
  // Lazily seeded so the first paint is current rather than epoch-zero. Cached
  // afterwards because getSnapshot must be referentially stable between ticks —
  // returning a fresh Date.now() on every call would re-render forever.
  if (cached === null) cached = Date.now()
  return cached
}

function getServerSnapshot(): number | null {
  return null
}

/** Milliseconds since the epoch, refreshed once a minute. Null before mount. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
