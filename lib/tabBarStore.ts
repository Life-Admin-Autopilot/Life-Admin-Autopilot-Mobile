// Lets a screen take the tab bar's slot for a while — selection mode's action
// bar is the first caller.
//
// A store rather than a prop because the tab bar is mounted once in Providers,
// as a sibling of the route slot, so a page has no way to reach it. Same reason
// lib/voice/captureStore.ts exists.
//
// Counted rather than a boolean: two surfaces can want the bar gone at once, and
// the first one to leave must not hand the slot back while the other is still
// using it.

import { useEffect } from 'react'
import { create } from 'zustand'

interface TabBarState {
  claims: number
  claim: () => void
  release: () => void
}

const useTabBarStore = create<TabBarState>((set) => ({
  claims: 0,
  claim: () => set((s) => ({ claims: s.claims + 1 })),
  release: () => set((s) => ({ claims: Math.max(0, s.claims - 1) })),
}))

export const useTabBarClaimed = () => useTabBarStore((s) => s.claims > 0)

/** Yields the tab bar's slot for as long as `active` holds. */
export function useClaimTabBarSlot(active: boolean) {
  const claim = useTabBarStore((s) => s.claim)
  const release = useTabBarStore((s) => s.release)

  useEffect(() => {
    if (!active) return
    claim()
    return release
  }, [active, claim, release])
}
