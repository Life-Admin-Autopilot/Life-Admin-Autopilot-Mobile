'use client'

import { useEffect, useState } from 'react'

// True when the primary input is a finger rather than a mouse.
//
// Used to decide what the Enter key means in the composer: on a touch keyboard
// Enter IS the return key, so intercepting it to send would leave a phone user
// unable to type a second line.
//
// Not a width check. This app ships to phones through Capacitor AND runs in a
// desktop browser at the same viewport width during development, and a narrow
// window on a laptop still has a hardware keyboard.
//
// Starts false so the server-rendered markup (static export prerenders this)
// matches the first client paint; the listener corrects it before the user can
// reach the keyboard.
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(pointer: coarse)')
    setCoarse(query.matches)
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return coarse
}
